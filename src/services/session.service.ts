import { Types } from 'mongoose';
import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { SessionModel, type SessionDocument } from '../models/session.model.js';
import type { SlotCode, QuestionType } from '../types/core.js';

/**
 * Convert SlotCode to internal slot key used in QuestionBlock.slots
 */
function slotCodeToFlag(slot: SlotCode): 'morning' | 'day' | 'evening' {
  switch (slot) {
    case 'MORNING':
      return 'morning';
    case 'DAY':
      return 'day';
    case 'EVENING':
      return 'evening';
  }
}

/**
 * Build a Date from dateKey ("YYYY-MM-DD").
 * We use UTC-based parsing, which is stable for day-of-week and day-of-month rules.
 */
function dateFromDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

/**
 * Returns ISO day of week in [1..7], where 1 = Monday, 7 = Sunday.
 */
function getIsoDayOfWeek(date: Date): number {
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 ? 7 : day;
}

/**
 * Check if a given date matches a monthly schedule.
 */
function isMonthScheduleActive(
  kind: 'DAY_OF_MONTH' | 'FIRST_DAY' | 'LAST_DAY',
  date: Date,
  dayOfMonth?: number
): boolean {
  const day = date.getUTCDate();

  if (kind === 'DAY_OF_MONTH') {
    if (!dayOfMonth) return false;
    return day === dayOfMonth;
  }

  if (kind === 'FIRST_DAY') {
    return day === 1;
  }

  if (kind === 'LAST_DAY') {
    const nextDay = new Date(date);
    nextDay.setUTCDate(day + 1);
    return nextDay.getUTCMonth() !== date.getUTCMonth();
  }

  return false;
}

/**
 * Load all question blocks that are active for a given user, slot and date.
 * Combines DAILY, WEEKLY and MONTHLY blocks.
 */
async function loadActiveBlocksForUserSlotDate(
  userId: Types.ObjectId,
  slot: SlotCode,
  dateKey: string
) {
  const date = dateFromDateKey(dateKey);
  const isoDayOfWeek = getIsoDayOfWeek(date); // 1..7
  const slotFlag = slotCodeToFlag(slot);

  // DAILY: active every day if bound to this slot
  const dailyBlocks = await QuestionBlockModel.find({
    userId,
    type: 'DAILY',
    [`slots.${slotFlag}`]: true,
  })
    .sort({ createdAt: 1 })
    .exec();

  // WEEKLY: active only on configured daysOfWeek
  const weeklyBlocks = await QuestionBlockModel.find({
    userId,
    type: 'WEEKLY',
    [`slots.${slotFlag}`]: true,
  })
    .sort({ createdAt: 1 })
    .exec();

  const activeWeeklyBlocks = weeklyBlocks.filter((block) => {
    const days = block.daysOfWeek ?? [];
    return days.includes(isoDayOfWeek);
  });

  // MONTHLY: active only according to monthSchedule
  const monthlyBlocks = await QuestionBlockModel.find({
    userId,
    type: 'MONTHLY',
    [`slots.${slotFlag}`]: true,
  })
    .sort({ createdAt: 1 })
    .exec();

  const activeMonthlyBlocks = monthlyBlocks.filter((block) => {
    const schedule = block.monthSchedule;
    if (!schedule) return false;
    return isMonthScheduleActive(schedule.kind, date, schedule.dayOfMonth);
  });

  return {
    dailyBlocks,
    activeWeeklyBlocks,
    activeMonthlyBlocks,
  };
}

/**
 * Build an ordered list of session questions from DAILY, WEEKLY and MONTHLY blocks.
 * Question keys are made unique per session using blockId + question key.
 */
function buildSessionQuestionsFromBlocks(
  blocks: Array<{
    type: QuestionType;
    _id: Types.ObjectId;
    questions: Array<{ key: string; text: string; order: number }>;
  }>
): SessionDocument['questions'] {
  const questions: SessionDocument['questions'] = [];
  let globalOrder = 0;

  const sortedBlocks = [...blocks]; // keep original array intact

  for (const block of sortedBlocks) {
    const sortedQuestions = [...block.questions].sort(
      (a, b) => a.order - b.order
    );

    for (const q of sortedQuestions) {
      const compositeKey = `${block._id.toString()}:${q.key}`;

      questions.push({
        key: compositeKey,
        text: q.text,
        sourceType: block.type,
        blockId: block._id,
        order: globalOrder++,
      });
    }
  }

  return questions;
}

/**
 * Get existing session or create a new one for a given user, slot and dateKey.
 */
export async function getOrCreateSessionForUserSlotDate(
  userId: Types.ObjectId,
  slot: SlotCode,
  dateKey: string
): Promise<SessionDocument> {
  // Try to find existing session
  const existing = await SessionModel.findOne({
    userId,
    slot,
    dateKey,
  }).exec();

  if (existing) {
    return existing;
  }

  // Load active question blocks
  const { dailyBlocks, activeWeeklyBlocks, activeMonthlyBlocks } =
    await loadActiveBlocksForUserSlotDate(userId, slot, dateKey);

  const allBlocks = [
    ...dailyBlocks,
    ...activeWeeklyBlocks,
    ...activeMonthlyBlocks,
  ].map((block) => ({
    type: block.type as QuestionType,
    _id: block._id,
    questions: block.questions,
  }));

  const questions = buildSessionQuestionsFromBlocks(allBlocks);

  // Even if there are zero questions, we still can create an empty session
  try {
    const session = await SessionModel.create({
      userId,
      slot,
      dateKey,
      status: 'pending',
      questions,
      currentQuestionIndex: 0,
      answers: [],
    });

    return session;
  } catch (error: any) {
    // If another request created the session concurrently, return that one
    if (error?.code === 11000) {
      const concurrent = await SessionModel.findOne({
        userId,
        slot,
        dateKey,
      }).exec();
      if (concurrent) return concurrent;
    }
    throw error;
  }
}
