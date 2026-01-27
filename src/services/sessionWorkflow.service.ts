import mongoose from 'mongoose';
import type { Context } from 'telegraf';

import { DEFAULT_TIMEZONE } from '../config/constants.js';
import { SessionModel, type SessionDocument } from '../models/session.model.js';
import type { SlotCode } from '../types/core.js';
import type { SlotConfig } from '../models/user.model.js';
import { buildQuestionPrompt, buildSessionCompletionSummary } from '../utils/format.js';
import { getDateKeyForTimezone } from '../utils/time.js';

export function pickNextSlotForReflection(
  slots: SlotConfig[] | undefined,
  nowMinutes: number
): SlotCode | null {
  if (!slots || slots.length === 0) return null;

  const candidates = slots
    .map((slot) => {
      const startMinutes =
        slot.mode === 'FIXED' ? slot.timeMinutes : slot.windowStartMinutes;

      return {
        slot: slot.slot,
        startMinutes,
      };
    })
    .filter(
      (candidate): candidate is { slot: SlotCode; startMinutes: number } =>
        typeof candidate.startMinutes === 'number'
    )
    .sort((a, b) => a.startMinutes - b.startMinutes);

  if (!candidates.length) return null;

  const upcoming = candidates.find((c) => c.startMinutes >= nowMinutes);
  return (upcoming ?? candidates[0]).slot;
}

export async function expireOldSessions(
  userId: mongoose.Types.ObjectId,
  timezone: string
): Promise<string> {
  const todayKey = getDateKeyForTimezone(timezone || DEFAULT_TIMEZONE);
  await SessionModel.updateMany(
    {
      userId,
      status: { $in: ['pending', 'in_progress'] },
      dateKey: { $lt: todayKey },
    },
    { status: 'expired' }
  ).exec();
  return todayKey;
}

export async function getTodayActiveSessions(
  userId: mongoose.Types.ObjectId,
  dateKey: string
): Promise<SessionDocument[]> {
  return SessionModel.find({
    userId,
    dateKey,
    status: { $in: ['pending', 'in_progress'] },
  })
    .sort({ createdAt: 1 })
    .exec();
}

export async function replyWithSessionProgress(
  ctx: Context,
  session: SessionDocument,
  replyOptions?: any
): Promise<void> {
  if (!session.questions.length) {
    await ctx.reply('No questions configured for this slot yet.');
    return;
  }

  const currentIndex = Math.min(
    session.currentQuestionIndex ?? 0,
    session.questions.length - 1
  );

  if (currentIndex >= session.questions.length) {
    await ctx.reply(buildSessionCompletionSummary(session), {
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  session.status = 'in_progress';
  session.startedAt ||= new Date();
  session.lastInteractionAt = new Date();
  await session.save();

  const question = session.questions[currentIndex];
  await ctx.reply(
    buildQuestionPrompt(
      session.slot,
      question.text,
      currentIndex,
      session.questions.length
    ),
    replyOptions
  );
}
