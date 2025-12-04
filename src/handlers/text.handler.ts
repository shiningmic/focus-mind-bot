import type { Context, Telegraf } from 'telegraf';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { UserModel } from '../models/user.model.js';
import { pendingActions } from '../state/pending.js';
import {
  pushKeyboard,
  popKeyboard,
  resetNavigation,
} from '../state/navigation.js';
import {
  ADD_DAILY_BUTTON,
  ADD_MONTHLY_BUTTON,
  ADD_WEEKLY_BUTTON,
  BACK_BUTTON_LABEL,
  buildStartKeyboard,
  HELP_BUTTON_LABEL,
  QUICK_ACTION_LABELS,
  SETTINGS_BUTTON_LABEL,
  SETTINGS_BUTTON_LABELS,
  REMINDER_BUTTON_LABELS,
  buildDailyKeyboard,
  buildBackKeyboard,
  buildMonthlyKeyboard,
  buildWeeklyKeyboard,
} from '../ui/keyboards.js';
import { formatSlotSummary, getSlotLabel } from '../utils/format.js';
import {
  getDateKeyForTimezone,
  isValidTimezone,
  parseSlotInput,
} from '../utils/time.js';
import { handleBlocksList } from '../flows/blocks.js';
import { handleSlotsCommand } from '../flows/slots.js';
import { DEFAULT_TIMEZONE } from '../config/constants.js';
import { applySingleSlotUpdate } from '../services/slots.service.js';
import type { SlotCode } from '../types/core.js';

// Import flows
import {
  startDailyCreateFlow,
  startDailyEditFlow,
  handleEditDailyFlow,
  handleCreateDailyFlow,
} from '../flows/daily.flow.js';
import {
  startWeeklyCreateFlow,
  startWeeklyEditFlow,
  handleEditWeeklyFlow,
  handleCreateWeeklyFlow,
} from '../flows/weekly.flow.js';
import {
  startMonthlyCreateFlow,
  startMonthlyEditFlow,
  handleEditMonthlyFlow,
  handleCreateMonthlyFlow,
} from '../flows/monthly.flow.js';
import { handleSessionAnswer } from '../flows/sessionAnswers.flow.js';

export function registerTextHandler(bot: Telegraf): void {
  bot.on('text', async (ctx: Context) => {
    try {
      const from = ctx.from;
      if (!from) {
        await ctx.reply(
          'Unable to read your Telegram profile. Please try again.'
        );
        return;
      }

      const user = await UserModel.findOne({ telegramId: from.id }).exec();
      if (!user) {
        await ctx.reply(
          'You do not have a Focus Mind profile yet. Send /start first.'
        );
        return;
      }

      const originalReply = ctx.reply.bind(ctx) as (...args: any[]) => any;
      (ctx as any).reply = (...args: any[]) => {
        const options = args.find(
          (a) => a && typeof a === 'object' && !Array.isArray(a)
        ) as any;
        if (!options?.skipNavPush) {
          const kb =
            extractKeyboard(args[1]) ?? extractKeyboard(args[2]) ?? null;
          if (kb && from?.id) {
            pushKeyboard(from.id, kb);
          }
        }
        if (options?.skipNavPush) {
          delete options.skipNavPush;
        }
        return originalReply(...args);
      };

      const messageText =
        (ctx.message as { text?: string } | undefined)?.text?.trim() ?? '';
      const pendingAction = pendingActions.get(from.id);

      if (isBackMessage(messageText)) {
        const handled = await handleBackNavigation(ctx, pendingAction);
        if (handled) return;
      }

      // Quick help
      if (messageText === HELP_BUTTON_LABEL) {
        const { sendHelp } = await import('../commands/help.command.js');
        await sendHelp(ctx);
        return;
      }

      if (messageText === SETTINGS_BUTTON_LABEL) {
        const { sendSettings } = await import(
          '../commands/settings.command.js'
        );
        await sendSettings(ctx);
        return;
      }

      // Quick action buttons for slots / timezone
      const quickSlot = mapActionTextToSlot(messageText);
      if (quickSlot) {
        await startSlotChangeFlow(ctx, user, quickSlot);
        return;
      }

      if (messageText === QUICK_ACTION_LABELS.timezone) {
        await startTimezoneChangeFlow(ctx, user);
        return;
      }

      const reminderAction = mapReminderButtonToAction(messageText);
      if (reminderAction) {
        const { handleReflect } = await import(
          '../commands/reflect.command.js'
        );
        if (reminderAction.action === 'skip') {
          await handleReflect(ctx, {
            skipPrevious: true,
            targetSlot: reminderAction.slot ?? null,
          });
        } else if (reminderAction.action === 'start') {
          await handleReflect(ctx, {
            skipPrevious: false,
            targetSlot: reminderAction.slot ?? null,
          });
        }
        return;
      }

      // Settings menu buttons
      const settingsAction = mapSettingsButtonToAction(messageText);
      if (settingsAction === 'slots') {
        await handleSlotsCommand(ctx, '/slots');
        return;
      }
      if (settingsAction === 'daily') {
        await handleBlocksList(ctx, 'DAILY');
        return;
      }
      if (settingsAction === 'weekly') {
        await handleBlocksList(ctx, 'WEEKLY');
        return;
      }
      if (settingsAction === 'monthly') {
        await handleBlocksList(ctx, 'MONTHLY');
        return;
      }

      // Creation buttons
      if (messageText === ADD_DAILY_BUTTON) {
        await startDailyCreateFlow(ctx);
        return;
      }
      if (messageText === ADD_WEEKLY_BUTTON) {
        await startWeeklyCreateFlow(ctx);
        return;
      }
      if (messageText === ADD_MONTHLY_BUTTON) {
        await startMonthlyCreateFlow(ctx);
        return;
      }

      // Handle pending multi-step flows FIRST (before block selection)
      if (pendingAction?.type === 'slot') {
        const parsed = parseSlotInput(messageText);
        if (!parsed) {
          await ctx.reply(
            'Could not parse time. Use HH:MM or HH:MM-HH:MM formats.',
            { ...buildBackKeyboard(), skipNavPush: true } as any
          );
          return;
        }

        user.slots = applySingleSlotUpdate(
          user.slots as any,
          pendingAction.slot,
          parsed
        );
        await user.save();
        pendingActions.delete(from.id);

        const updated = user.slots.find((s) => s.slot === pendingAction.slot);
        await ctx.reply(
          updated
            ? `Saved. ${formatSlotSummary(updated)}.`
            : 'Saved, but slot not found. Please re-open /slots.',
          { ...buildBackKeyboard(), skipNavPush: true } as any
        );
        return;
      }

      if (pendingAction?.type === 'timezone') {
        const tz = messageText.trim();
        if (!isValidTimezone(tz)) {
          await ctx.reply(
            'Unknown timezone. Please provide a valid IANA timezone like Europe/Kyiv or America/New_York.',
            { ...buildBackKeyboard(), skipNavPush: true } as any
          );
          return;
        }

        user.timezone = tz;
        await user.save();
        pendingActions.delete(from.id);

        await ctx.reply(`Timezone updated to ${user.timezone}.`, {
          ...buildBackKeyboard(),
          skipNavPush: true,
        } as any);
        return;
      }

      // Route to flow handlers
      if (pendingAction?.type === 'editDaily') {
        await handleEditDailyFlow(ctx, user._id, messageText, pendingAction);
        return;
      }

      if (pendingAction?.type === 'createDaily') {
        await handleCreateDailyFlow(ctx, user._id, messageText, pendingAction);
        return;
      }

      if (pendingAction?.type === 'editWeekly') {
        await handleEditWeeklyFlow(ctx, user._id, messageText, pendingAction);
        return;
      }

      if (pendingAction?.type === 'createWeekly') {
        await handleCreateWeeklyFlow(ctx, user._id, messageText, pendingAction);
        return;
      }

      if (pendingAction?.type === 'editMonthly') {
        await handleEditMonthlyFlow(ctx, user._id, messageText, pendingAction);
        return;
      }

      if (pendingAction?.type === 'createMonthly') {
        await handleCreateMonthlyFlow(
          ctx,
          user._id,
          messageText,
          pendingAction
        );
        return;
      }
      // Handle block selection buttons (prefixed with emoji)
      // Only process if no pending action (to avoid conflicts with edit buttons)
      if (!pendingAction) {
        const match = /^[^\p{L}\p{N}]+(.+)$/u.exec(messageText);
        if (match) {
          const blockNameNormalized = match[1].trim().toLowerCase();

          const findByNormalizedName = async (
            type: 'DAILY' | 'WEEKLY' | 'MONTHLY'
          ) => {
            const blocks = await QuestionBlockModel.find({
              userId: user._id,
              type,
            })
              .select('name')
              .lean()
              .exec();
            return blocks.find(
              (b) => (b.name ?? '').trim().toLowerCase() === blockNameNormalized
            );
          };

          if (await findByNormalizedName('MONTHLY')) {
            await startMonthlyEditFlow(ctx, messageText);
            return;
          }
          if (await findByNormalizedName('WEEKLY')) {
            await startWeeklyEditFlow(ctx, messageText);
            return;
          }
          if (await findByNormalizedName('DAILY')) {
            await startDailyEditFlow(ctx, messageText);
            return;
          }

          await ctx.reply('Block not found. Please try again.');
          return;
        }
      }

      // If no pending actions – treat text as session answer
      await handleSessionAnswer(ctx, user._id, messageText);
    } catch (error) {
      console.error('Error in text handler:', error);
      await ctx.reply('Something went wrong. Please try again later.');
    }
  });
}

function isBackMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return text === BACK_BUTTON_LABEL || lower === '/back' || lower === 'back';
}

function mapActionTextToSlot(text: string): SlotCode | null {
  if (text === QUICK_ACTION_LABELS.morning) return 'MORNING';
  if (text === QUICK_ACTION_LABELS.day) return 'DAY';
  if (text === QUICK_ACTION_LABELS.evening) return 'EVENING';
  return null;
}

function mapReminderButtonToAction(
  text: string
): { action: 'skip' | 'start'; slot?: SlotCode } | null {
  const normalized = text.toLowerCase();
  const startPrefix = REMINDER_BUTTON_LABELS.startPrefix.toLowerCase();
  const skipPrefix = REMINDER_BUTTON_LABELS.skipPrefix.toLowerCase();

  if (normalized.startsWith(startPrefix)) {
    if (normalized.includes('morning'))
      return { action: 'start', slot: 'MORNING' };
    if (normalized.includes('day')) return { action: 'start', slot: 'DAY' };
    if (normalized.includes('evening'))
      return { action: 'start', slot: 'EVENING' };
    return { action: 'start' };
  }

  if (normalized.startsWith(skipPrefix)) {
    if (normalized.includes('morning'))
      return { action: 'skip', slot: 'MORNING' };
    if (normalized.includes('day')) return { action: 'skip', slot: 'DAY' };
    if (normalized.includes('evening'))
      return { action: 'skip', slot: 'EVENING' };
    return { action: 'skip' };
  }

  return null;
}

function mapSettingsButtonToAction(
  text: string
): 'slots' | 'daily' | 'weekly' | 'monthly' | null {
  if (text === SETTINGS_BUTTON_LABELS.slots) return 'slots';
  if (text === SETTINGS_BUTTON_LABELS.daily) return 'daily';
  if (text === SETTINGS_BUTTON_LABELS.weekly) return 'weekly';
  if (text === SETTINGS_BUTTON_LABELS.monthly) return 'monthly';
  return null;
}

async function startSlotChangeFlow(
  ctx: Context,
  user: { telegramId: number },
  slot: SlotCode
): Promise<void> {
  // Remember where we came from so Back can return there
  pushKeyboard(user.telegramId, buildBackKeyboard());
  pendingActions.set(user.telegramId, { type: 'slot', slot });
  const label = getSlotLabel(slot);
  await ctx.reply(
    `What time do you want to set for ${label}? Send either:\n` +
      `- Fixed time: HH:MM (e.g. 08:30)\n` +
      `- Random window: HH:MM-HH:MM (e.g. 13:00-15:00)`,
    { ...buildBackKeyboard(), skipNavPush: true } as any
  );
}

async function startTimezoneChangeFlow(
  ctx: Context,
  user: { telegramId: number }
): Promise<void> {
  // Remember where we came from so Back can return there
  pushKeyboard(user.telegramId, buildBackKeyboard());
  pendingActions.set(user.telegramId, { type: 'timezone' });
  await ctx.reply(
    'Send a timezone in IANA format, e.g. Europe/Kyiv or America/New_York.',
    { ...buildBackKeyboard(), skipNavPush: true } as any
  );
}

async function handleBackNavigation(
  ctx: Context,
  pendingAction: import('../state/pending.js').PendingAction | undefined
): Promise<boolean> {
  const fromId = ctx.from?.id;
  if (!fromId) return false;

  if (
    pendingAction?.type === 'editDaily' ||
    pendingAction?.type === 'createDaily'
  ) {
    pendingActions.delete(fromId);
    resetNavigation(fromId);
    await handleBlocksList(ctx, 'DAILY');
    return true;
  }

  if (
    pendingAction?.type === 'editWeekly' ||
    pendingAction?.type === 'createWeekly'
  ) {
    pendingActions.delete(fromId);
    resetNavigation(fromId);
    await handleBlocksList(ctx, 'WEEKLY');
    return true;
  }

  if (
    pendingAction?.type === 'editMonthly' ||
    pendingAction?.type === 'createMonthly'
  ) {
    pendingActions.delete(fromId);
    resetNavigation(fromId);
    await handleBlocksList(ctx, 'MONTHLY');
    return true;
  }

  if (pendingAction?.type === 'slot' || pendingAction?.type === 'timezone') {
    pendingActions.delete(fromId);
    const prevKb = popKeyboard(fromId);
    resetNavigation(fromId);
    if (prevKb) {
      await ctx.reply('Back.', { ...prevKb, skipNavPush: true } as any);
    } else {
      await ctx.reply('Back to start.', {
        ...buildStartKeyboard(),
        skipNavPush: true,
      } as any);
    }
    return true;
  }

  const prevKb = popKeyboard(fromId);
  pendingActions.delete(fromId);
  resetNavigation(fromId);
  if (prevKb) {
    await ctx.reply('Back.', { ...prevKb, skipNavPush: true } as any);
  } else {
    const startKb = buildStartKeyboard();
    await ctx.reply('Back to start.', { ...startKb, skipNavPush: true } as any);
  }
  return true;
}

function extractKeyboard(opt: any): any | null {
  if (!opt) return null;
  if (opt?.reply_markup?.keyboard) return opt;
  if (opt?.keyboard) return opt;
  return null;
}
