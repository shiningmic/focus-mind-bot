import type { Types } from 'mongoose';
import { QuestionBlockModel } from '../models/questionBlock.model.js';
import type { QuestionType, SlotCode } from '../types/core.js';

/**
 * Create a single question block for a given user.
 */
export async function createQuestionBlock(options: {
  userId: Types.ObjectId;
  type: QuestionType;
  name: string;
  slots: Partial<Record<SlotCode, boolean>>;
  questions: Array<{ key: string; text: string }>;
  daysOfWeek?: number[];
  monthSchedule?: {
    kind: 'DAY_OF_MONTH' | 'FIRST_DAY' | 'LAST_DAY';
    dayOfMonth?: number;
  };
}) {
  const { userId, type, name, slots, questions, daysOfWeek, monthSchedule } =
    options;

  return QuestionBlockModel.create({
    userId,
    type,
    name,
    slots: {
      morning: Boolean(slots.MORNING),
      day: Boolean(slots.DAY),
      evening: Boolean(slots.EVENING),
    },
    questions: questions.map((q, index) => ({
      key: q.key,
      text: q.text,
      order: index,
    })),
    daysOfWeek,
    monthSchedule,
  });
}

/**
 * Create default daily/weekly/monthly question blocks for a new user.
 * Only runs if user currently has no question blocks.
 */
export async function ensureDefaultQuestionBlocksForUser(
  userId: Types.ObjectId
): Promise<void> {
  const existingCount = await QuestionBlockModel.countDocuments({
    userId,
  }).exec();
  if (existingCount > 0) {
    // User already has some blocks, do not overwrite
    return;
  }

  // === DAILY BLOCKS ===

  // Morning: basic focus & mood
  await createQuestionBlock({
    userId,
    type: 'DAILY',
    name: 'Morning Focus',
    slots: { MORNING: true },
    questions: [
      { key: 'mood', text: '☀️ How do you feel this morning?' },
      { key: 'priority', text: '🔍 What is your #1 priority today?' },
      { key: 'intent', text: '💡 What is your main intention for today?' },
    ],
  });

  // Day: small check-in
  await createQuestionBlock({
    userId,
    type: 'DAILY',
    name: 'Midday Check-in',
    slots: { DAY: true },
    questions: [
      { key: 'progress', text: '📈 How is your progress so far today?' },
      {
        key: 'emotion_now',
        text: '😬 What emotion are you feeling right now?',
      },
      { key: 'focus', text: '🎯 Are you focused on what truly matters?' },
    ],
  });

  // Evening: short reflection
  await createQuestionBlock({
    userId,
    type: 'DAILY',
    name: 'Evening Reflection',
    slots: { EVENING: true },
    questions: [
      { key: 'main_achievement', text: '🏆 Main achievement today?' },
      { key: 'top3', text: '🎯 Top 3 tasks for tomorrow?' },
      { key: 'mood_end', text: '🌙 How do you feel at the end of the day?' },
    ],
  });

  // === WEEKLY BLOCKS ===

  // Weekly planning on Monday morning
  await createQuestionBlock({
    userId,
    type: 'WEEKLY',
    name: 'Weekly Planning',
    slots: { MORNING: true },
    daysOfWeek: [1], // Monday
    questions: [
      {
        key: 'weekly_top3',
        text: '🎯 What are your top 3 priorities for this week?',
      },
      {
        key: 'weekly_risks',
        text: '⚠️ Any risks or distractions you expect this week?',
      },
    ],
  });

  // Weekly review on Friday evening
  await createQuestionBlock({
    userId,
    type: 'WEEKLY',
    name: 'Weekly Review',
    slots: { EVENING: true },
    daysOfWeek: [5], // Friday
    questions: [
      { key: 'weekly_win', text: '🏅 What was your biggest win this week?' },
      {
        key: 'weekly_challenge',
        text: '🧩 What was the main challenge this week?',
      },
      { key: 'weekly_lesson', text: '📚 What did you learn this week?' },
    ],
  });

  // === MONTHLY BLOCKS ===

  // Monthly planning on first day of month, morning
  await createQuestionBlock({
    userId,
    type: 'MONTHLY',
    name: 'Monthly Planning',
    slots: { MORNING: true },
    monthSchedule: {
      kind: 'FIRST_DAY',
    },
    questions: [
      {
        key: 'month_focus',
        text: '🎯 What is your main focus for the upcoming month?',
      },
      {
        key: 'month_habits',
        text: '🔁 Which habits do you want to strengthen this month?',
      },
    ],
  });

  // Monthly review on last day of month, evening
  await createQuestionBlock({
    userId,
    type: 'MONTHLY',
    name: 'Monthly Review',
    slots: { EVENING: true },
    monthSchedule: {
      kind: 'LAST_DAY',
    },
    questions: [
      {
        key: 'month_win',
        text: '🏆 What was your biggest achievement this month?',
      },
      {
        key: 'month_growth',
        text: '🌱 In what area did you grow the most?',
      },
      {
        key: 'month_change',
        text: '🔄 What will you change next month?',
      },
    ],
  });
}
