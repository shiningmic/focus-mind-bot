import type { Context, Telegraf } from 'telegraf';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { SessionModel } from '../models/session.model.js';
import { UserModel } from '../models/user.model.js';
import { pendingActions } from '../state/pending.js';
import {
  ADD_DAILY_BUTTON,
  ADD_MONTHLY_BUTTON,
  ADD_WEEKLY_BUTTON,
  DAILY_EDIT_ACTION_BUTTONS,
  HELP_BUTTON_LABEL,
  MONTHLY_EDIT_ACTION_BUTTONS,
  QUICK_ACTION_LABELS,
  SETTINGS_BUTTON_LABELS,
  WEEKLY_EDIT_ACTION_BUTTONS,
  buildDailyEditKeyboard,
  buildDailyKeyboard,
  buildMainKeyboard,
  buildMonthlyEditKeyboard,
  buildMonthlyKeyboard,
  buildSettingsKeyboard,
  buildWeeklyEditKeyboard,
  buildWeeklyKeyboard,
} from '../ui/keyboards.js';
import {
  buildQuestionPrompt,
  buildSessionCompletionSummary,
  formatMonthSchedule,
  formatSlotsForBlock,
  formatWeekdays,
  getSlotLabel,
} from '../utils/format.js';
import {
  ParsedSlotInput,
  getDateKeyForTimezone,
  getTimezoneMinutesNow,
  isValidTimezone,
  parseSlotInput,
  questionTypeFromString,
  slotCodeFromString,
} from '../utils/time.js';
import { parseSlotsFlag } from '../utils/slots.js';
import {
  getTodayActiveSessions,
  pickNextSlotForReflection,
  replyWithSessionProgress,
} from '../services/sessionWorkflow.service.js';
import { handleBlocksList } from '../flows/blocks.js';
import { handleSlotsCommand } from '../flows/slots.js';
import { DEFAULT_TIMEZONE } from '../config/constants.js';

import type { QuestionType, SlotCode } from '../types/core.js';

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

      // Quick help
      if (messageText === HELP_BUTTON_LABEL) {
        const { sendHelp } = await import('../commands/help.command.js');
        await sendHelp(ctx);
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
        // Reuse /slots flow
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

      // Handle pending multi-step flows
      const pendingAction = pendingActions.get(from.id);

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

      // If no pending actions – treat text as session answer
      await handleSessionAnswer(ctx, user._id, messageText);
    } catch (error) {
      console.error('Error in text handler:', error);
      await ctx.reply('Something went wrong. Please try again later.');
    }
  });
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
      `- Random window: HH:MM-HH:MM (e.g. 13:00-15:00)`,
    buildMainKeyboard()
  );
}

async function startTimezoneChangeFlow(
  ctx: Context,
  user: { telegramId: number }
): Promise<void> {
  pendingActions.set(user.telegramId, { type: 'timezone' });
  await ctx.reply(
    'Send a timezone in IANA format, e.g. Europe/Kyiv or America/New_York.',
    buildMainKeyboard()
  );
}

// --- DAILY FLOWS ---

async function startDailyEditFlow(
  ctx: Context,
  blockName: string
): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const order: Array<'morning' | 'day' | 'evening'> = [
    'morning',
    'day',
    'evening',
  ];
  const dailyBlocks = await QuestionBlockModel.find({
    userId: user._id,
    type: 'DAILY',
  })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  const sorted = [...dailyBlocks].sort((a, b) => {
    const aIdxRaw = order.findIndex((s) => (a.slots as any)[s]);
    const bIdxRaw = order.findIndex((s) => (b.slots as any)[s]);
    const aIdx = aIdxRaw === -1 ? order.length : aIdxRaw;
    const bIdx = bIdxRaw === -1 ? order.length : bIdxRaw;
    return aIdx - bIdx;
  });

  const targetName = blockName
    .replace(/^✏️\s*/, '')
    .trim()
    .toLowerCase();
  const block = sorted.find((b) => b.name.trim().toLowerCase() === targetName);
  if (!block) {
    await ctx.reply('This daily set does not exist. Try another.');
    return;
  }

  pendingActions.set(from.id, {
    type: 'editDaily',
    step: 'menu',
    blockId: block._id.toString(),
    blockName: block.name,
  });

  await ctx.reply(
    `Editing daily set "${block.name}".\nChoose what to change: slot, name, or any question.`,
    buildDailyEditKeyboard()
  );
}

async function startDailyCreateFlow(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const count = await QuestionBlockModel.countDocuments({
    userId: user._id,
    type: 'DAILY',
  }).exec();

  if (count >= 3) {
    await ctx.reply(
      'You already have 3 daily sets. Delete one to add another.',
      buildDailyKeyboard()
    );
    return;
  }

  pendingActions.set(from.id, {
    type: 'createDaily',
    step: 'name',
    temp: {},
  });

  await ctx.reply(
    'Enter a name for the new daily set:',
    buildDailyEditKeyboard()
  );
}

// --- WEEKLY FLOWS ---

async function startWeeklyEditFlow(
  ctx: Context,
  blockName: string
): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const order: Array<'morning' | 'day' | 'evening'> = [
    'morning',
    'day',
    'evening',
  ];
  const weeklyBlocks = await QuestionBlockModel.find({
    userId: user._id,
    type: 'WEEKLY',
  })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  const sorted = [...weeklyBlocks].sort((a, b) => {
    const aIdxRaw = order.findIndex((s) => (a.slots as any)[s]);
    const bIdxRaw = order.findIndex((s) => (b.slots as any)[s]);
    const aIdx = aIdxRaw === -1 ? order.length : aIdxRaw;
    const bIdx = bIdxRaw === -1 ? order.length : bIdxRaw;
    return aIdx - bIdx;
  });

  const targetName = blockName
    .replace(/^✏️\s*/, '')
    .trim()
    .toLowerCase();
  const block = sorted.find((b) => b.name.trim().toLowerCase() === targetName);

  if (!block) {
    await ctx.reply('This weekly set does not exist. Try another.');
    return;
  }

  pendingActions.set(from.id, {
    type: 'editWeekly',
    step: 'menu',
    blockId: block._id.toString(),
    blockName: block.name,
  });

  await ctx.reply(
    `Editing weekly set "${block.name}".\nUse buttons to change slots, days, name, or questions.`,
    buildWeeklyEditKeyboard()
  );
}

async function startWeeklyCreateFlow(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const count = await QuestionBlockModel.countDocuments({
    userId: user._id,
    type: 'WEEKLY',
  }).exec();

  if (count >= 3) {
    await ctx.reply(
      'You already have 3 weekly sets. Delete one to add another.',
      buildWeeklyKeyboard()
    );
    return;
  }

  pendingActions.set(from.id, {
    type: 'createWeekly',
    step: 'name',
    temp: {},
  });

  await ctx.reply(
    'Enter a name for the new weekly set:',
    buildWeeklyEditKeyboard()
  );
}

// --- MONTHLY FLOWS ---

function parseMonthScheduleInput(raw: string) {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'first') return { kind: 'FIRST_DAY' as const };
  if (trimmed === 'last') return { kind: 'LAST_DAY' as const };
  if (trimmed.startsWith('day:')) {
    const num = Number.parseInt(trimmed.slice(4), 10);
    if (!Number.isInteger(num) || num < 1 || num > 28) return null;
    return { kind: 'DAY_OF_MONTH' as const, dayOfMonth: num };
  }
  return null;
}

async function startMonthlyEditFlow(
  ctx: Context,
  blockName: string
): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const order: Array<'morning' | 'day' | 'evening'> = [
    'morning',
    'day',
    'evening',
  ];
  const monthlyBlocks = await QuestionBlockModel.find({
    userId: user._id,
    type: 'MONTHLY',
  })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  const sorted = [...monthlyBlocks].sort((a, b) => {
    const aIdxRaw = order.findIndex((s) => (a.slots as any)[s]);
    const bIdxRaw = order.findIndex((s) => (b.slots as any)[s]);
    const aIdx = aIdxRaw === -1 ? order.length : aIdxRaw;
    const bIdx = bIdxRaw === -1 ? order.length : bIdxRaw;
    return aIdx - bIdx;
  });

  const targetName = blockName
    .replace(/^✏️\s*/, '')
    .trim()
    .toLowerCase();
  const block = sorted.find((b) => b.name.trim().toLowerCase() === targetName);

  if (!block) {
    await ctx.reply('This monthly set does not exist. Try another.');
    return;
  }

  pendingActions.set(from.id, {
    type: 'editMonthly',
    step: 'menu',
    blockId: block._id.toString(),
    blockName: block.name,
  });

  await ctx.reply(
    `Editing monthly set "${block.name}".\nUse buttons to change slots, schedule, name, or questions.`,
    buildMonthlyEditKeyboard()
  );
}

async function startMonthlyCreateFlow(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const count = await QuestionBlockModel.countDocuments({
    userId: user._id,
    type: 'MONTHLY',
  }).exec();

  if (count >= 3) {
    await ctx.reply(
      'You already have 3 monthly sets. Delete one to add another.',
      buildMonthlyKeyboard()
    );
    return;
  }

  pendingActions.set(from.id, {
    type: 'createMonthly',
    step: 'name',
    temp: {},
  });

  await ctx.reply(
    'Enter a name for the new monthly set:',
    buildMonthlyEditKeyboard()
  );
}

// --- EDIT / CREATE FLOW HANDLERS ---

async function handleEditDailyFlow(
  ctx: Context,
  userId: typeof QuestionBlockModel.prototype.userId,
  messageText: string,
  pendingAction: any
): Promise<void> {
  // Implementation is still in the legacy index.ts and will be
  // fully migrated here in the next refactoring step. For now,
  // keep behaviour unchanged at runtime.
  await ctx.reply(
    'Daily edit flow is temporarily unavailable during refactoring. Please use /daily to view sets.',
    buildDailyKeyboard()
  );
}

async function handleCreateDailyFlow(
  ctx: Context,
  userId: typeof QuestionBlockModel.prototype.userId,
  messageText: string,
  pendingAction: any
): Promise<void> {
  await ctx.reply(
    'Daily create flow is temporarily unavailable during refactoring. Please use /daily to view sets.',
    buildDailyKeyboard()
  );
}

async function handleEditWeeklyFlow(
  ctx: Context,
  userId: typeof QuestionBlockModel.prototype.userId,
  messageText: string,
  pendingAction: any
): Promise<void> {
  await ctx.reply(
    'Weekly edit flow is temporarily unavailable during refactoring. Please use /weekly to view sets.',
    buildWeeklyKeyboard()
  );
}

async function handleCreateWeeklyFlow(
  ctx: Context,
  userId: typeof QuestionBlockModel.prototype.userId,
  messageText: string,
  pendingAction: any
): Promise<void> {
  await ctx.reply(
    'Weekly create flow is temporarily unavailable during refactoring. Please use /weekly to view sets.',
    buildWeeklyKeyboard()
  );
}

async function handleEditMonthlyFlow(
  ctx: Context,
  userId: typeof QuestionBlockModel.prototype.userId,
  messageText: string,
  pendingAction: any
): Promise<void> {
  await ctx.reply(
    'Monthly edit flow is temporarily unavailable during refactoring. Please use /monthly to view sets.',
    buildMonthlyKeyboard()
  );
}

async function handleCreateMonthlyFlow(
  ctx: Context,
  userId: typeof QuestionBlockModel.prototype.userId,
  messageText: string,
  pendingAction: any
): Promise<void> {
  await ctx.reply(
    'Monthly create flow is temporarily unavailable during refactoring. Please use /monthly to view sets.',
    buildMonthlyKeyboard()
  );
}

// --- SESSION ANSWERS ---

async function handleSessionAnswer(
  ctx: Context,
  userId: any,
  messageText: string
): Promise<void> {
  const user = await UserModel.findOne({ _id: userId }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const timezone = user.timezone || DEFAULT_TIMEZONE;
  const todayKey = getDateKeyForTimezone(timezone);

  const session = await SessionModel.findOne({
    userId: user._id,
    dateKey: todayKey,
    status: { $in: ['pending', 'in_progress'] },
  })
    .sort({ createdAt: -1 })
    .exec();

  if (!session) {
    await ctx.reply(
      'No active reflection session. Use /reflect to start one.',
      buildMainKeyboard()
    );
    return;
  }

  if (!session.questions.length) {
    await ctx.reply('No questions configured for this session.');
    return;
  }

  const index =
    typeof session.currentQuestionIndex === 'number'
      ? session.currentQuestionIndex
      : 0;

  const question = session.questions[index];

  const answerText = messageText.trim();
  if (!answerText) {
    await ctx.reply('Please enter a non-empty answer.');
    return;
  }

  session.answers.push({
    key: question.key,
    text: answerText,
    createdAt: new Date(),
  } as any);

  if (index + 1 >= session.questions.length) {
    session.status = 'completed';
    session.currentQuestionIndex = session.questions.length;
    session.lastInteractionAt = new Date();
    await session.save();
    await ctx.reply(buildSessionCompletionSummary(session));
    return;
  }

  session.currentQuestionIndex = index + 1;
  session.lastInteractionAt = new Date();
  await session.save();

  const nextQuestion = session.questions[session.currentQuestionIndex];
  await ctx.reply(
    buildQuestionPrompt(
      session.slot,
      nextQuestion.text,
      session.currentQuestionIndex,
      session.questions.length
    )
  );
}
