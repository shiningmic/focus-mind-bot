import type { Context, Telegraf } from 'telegraf';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { UserModel } from '../models/user.model.js';
import { pendingActions } from '../state/pending.js';
import {
  ADD_DAILY_BUTTON,
  ADD_MONTHLY_BUTTON,
  ADD_WEEKLY_BUTTON,
  HELP_BUTTON_LABEL,
  QUICK_ACTION_LABELS,
  SETTINGS_BUTTON_LABEL,
  SETTINGS_BUTTON_LABELS,
  BACK_BUTTON_LABEL,
  CANCEL_BUTTON_LABEL,
  buildDailyKeyboard,
  buildMainKeyboard,
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

      const messageText =
        (ctx.message as { text?: string } | undefined)?.text?.trim() ?? '';
      const pendingAction = pendingActions.get(from.id);

      if (isBackMessage(messageText)) {
        const handled = await handleBackNavigation(ctx, pendingAction);
        if (handled) return;
      }

      if (isCancelMessage(messageText)) {
        if (pendingAction) {
          pendingActions.delete(from.id);
          await ctx.reply('Cancelled.', buildMainKeyboard());
        } else {
          await ctx.reply('No active action to cancel.', buildMainKeyboard());
        }
        return;
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
      // This ensures edit action buttons are processed correctly
      if (pendingAction?.type === 'slot') {
        const parsed = parseSlotInput(messageText);
        if (!parsed) {
          await ctx.reply(
            'Could not parse time. Use HH:MM or HH:MM-HH:MM formats.',
            buildMainKeyboard()
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
          buildMainKeyboard()
        );
        return;
      }

      if (pendingAction?.type === 'timezone') {
        const tz = messageText.trim();
        if (!isValidTimezone(tz)) {
          await ctx.reply(
            'Unknown timezone. Please provide a valid IANA timezone like Europe/Kyiv or America/New_York.',
            buildMainKeyboard()
          );
          return;
        }

        user.timezone = tz;
        await user.save();
        pendingActions.delete(from.id);

        await ctx.reply(
          `Timezone updated to ${user.timezone}.`,
          buildMainKeyboard()
        );
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

function isCancelMessage(text: string): boolean {
  const lower = text.toLowerCase();
  return text === CANCEL_BUTTON_LABEL || lower === '/cancel' || lower === 'cancel';
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
  pendingActions.set(user.telegramId, { type: 'slot', slot });
  const label = getSlotLabel(slot);
  await ctx.reply(
    `What time do you want to set for ${label}? Send either:\n` +
      `- Fixed time: HH:MM (e.g. 08:30)\n` +
      `- Random window: HH:MM-HH:MM (e.g. 13:00-15:00)\n\n` +
      'Tap Cancel to stop editing.',
    buildMainKeyboard()
  );
}

async function startTimezoneChangeFlow(
  ctx: Context,
  user: { telegramId: number }
): Promise<void> {
  pendingActions.set(user.telegramId, { type: 'timezone' });
  await ctx.reply(
    'Send a timezone in IANA format, e.g. Europe/Kyiv or America/New_York. Tap Cancel to stop.',
    buildMainKeyboard()
  );
}

async function handleBackNavigation(
  ctx: Context,
  pendingAction: import('../state/pending.js').PendingAction | undefined
): Promise<boolean> {
  const fromId = ctx.from?.id;
  if (!fromId) return false;

  const goToSettings = async () => {
    const { sendSettings } = await import('../commands/settings.command.js');
    await sendSettings(ctx);
  };

  if (pendingAction?.type === 'editDaily' || pendingAction?.type === 'createDaily') {
    pendingActions.delete(fromId);
    await handleBlocksList(ctx, 'DAILY');
    return true;
  }

  if (pendingAction?.type === 'editWeekly' || pendingAction?.type === 'createWeekly') {
    pendingActions.delete(fromId);
    await handleBlocksList(ctx, 'WEEKLY');
    return true;
  }

  if (pendingAction?.type === 'editMonthly' || pendingAction?.type === 'createMonthly') {
    pendingActions.delete(fromId);
    await handleBlocksList(ctx, 'MONTHLY');
    return true;
  }

  if (pendingAction?.type === 'slot' || pendingAction?.type === 'timezone') {
    pendingActions.delete(fromId);
    await goToSettings();
    return true;
  }

  await goToSettings();
  return true;
}
