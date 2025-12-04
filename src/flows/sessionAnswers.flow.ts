import type { Context } from 'telegraf';
import mongoose from 'mongoose';

import { SessionModel } from '../models/session.model.js';
import {
  UserModel,
  type SlotConfig,
  type UserDocument,
} from '../models/user.model.js';
import { buildBackKeyboard } from '../ui/keyboards.js';
import {
  buildQuestionPrompt,
  buildSessionCompletionSummary,
} from '../utils/format.js';
import { getDateKeyForTimezone } from '../utils/time.js';
import { DEFAULT_TIMEZONE } from '../config/constants.js';
import { getOrCreateSessionForUserSlotDate } from '../services/session.service.js';
import { replyWithSessionProgress } from '../services/sessionWorkflow.service.js';

export async function handleSessionAnswer(
  ctx: Context,
  userId: mongoose.Types.ObjectId,
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
      buildBackKeyboard()
    );
    return;
  }

  if (!session.questions.length) {
    await ctx.reply('No questions configured for this session.');
    return;
  }

  const rawIndex =
    typeof session.currentQuestionIndex === 'number'
      ? session.currentQuestionIndex
      : 0;
  const index = Math.min(
    Math.max(rawIndex, 0),
    Math.max(session.questions.length - 1, 0)
  );

  const question = session.questions[index];

  const answerText = messageText.trim();
  if (!answerText) {
    await ctx.reply('Please enter a non-empty answer.');
    return;
  }

  // Remove existing answer for this question if any
  session.answers = session.answers.filter((a) => a.key !== question.key);
  session.answers.push({
    key: question.key,
    text: answerText,
    createdAt: new Date(),
  } as any);

  if (index + 1 >= session.questions.length) {
    session.status = 'completed';
    session.currentQuestionIndex = session.questions.length;
    session.lastInteractionAt = new Date();
    session.finishedAt = new Date();
    await session.save();
    await ctx.reply(buildSessionCompletionSummary(session), {
      parse_mode: 'MarkdownV2',
    });
    await maybeStartNextSameTimeSlot(ctx, user, session.slot, todayKey);
    return;
  }

  session.currentQuestionIndex = index + 1;
  session.status = 'in_progress';
  session.lastInteractionAt = new Date();
  session.startedAt ||= new Date();
  await session.save();

  const nextQuestion = session.questions[session.currentQuestionIndex];
  if (!nextQuestion) {
    session.status = 'completed';
    session.currentQuestionIndex = session.questions.length;
    session.lastInteractionAt = new Date();
    session.finishedAt = new Date();
    await session.save();
    await ctx.reply('Session already completed.', buildBackKeyboard());
    await maybeStartNextSameTimeSlot(ctx, user, session.slot, todayKey);
    return;
  }

  await ctx.reply(
    buildQuestionPrompt(
      session.slot,
      nextQuestion.text,
      session.currentQuestionIndex,
      session.questions.length
    )
  );
}

const slotOrder: Record<'MORNING' | 'DAY' | 'EVENING', number> = {
  MORNING: 0,
  DAY: 1,
  EVENING: 2,
};

async function maybeStartNextSameTimeSlot(
  ctx: Context,
  user: UserDocument,
  currentSlot: 'MORNING' | 'DAY' | 'EVENING',
  todayKey: string
): Promise<void> {
  const slots = (user.slots as SlotConfig[] | undefined) ?? [];

  const currentConfig = slots.find(
    (s) => s.slot === currentSlot && s.mode === 'FIXED'
  );
  if (!currentConfig || currentConfig.mode !== 'FIXED') return;

  const sameTimeSlots = slots
    .filter(
      (s) =>
        s.mode === 'FIXED' &&
        typeof s.timeMinutes === 'number' &&
        s.timeMinutes === currentConfig.timeMinutes
    )
    .sort((a, b) => slotOrder[a.slot] - slotOrder[b.slot]);

  const currentOrder = slotOrder[currentSlot];
  const next = sameTimeSlots.find((s) => slotOrder[s.slot] > currentOrder);
  if (!next) return;

  // If there is already an active session for this slot today, continue it
  const active = await SessionModel.findOne({
    userId: user._id,
    slot: next.slot,
    dateKey: todayKey,
    status: { $in: ['pending', 'in_progress'] },
  });
  if (active) {
    await replyWithSessionProgress(ctx, active);
    return;
  }

  const existing = await SessionModel.findOne({
    userId: user._id,
    slot: next.slot,
    dateKey: todayKey,
    status: { $in: ['completed', 'skipped'] },
  })
    .select('_id')
    .lean();
  if (existing) return;

  const nextSession = await getOrCreateSessionForUserSlotDate(
    user._id,
    next.slot,
    todayKey
  );

  await replyWithSessionProgress(ctx, nextSession);
}
