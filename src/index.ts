import 'dotenv/config';
import { Telegraf, type Context } from 'telegraf';
import mongoose from 'mongoose';

import { UserModel, type SlotConfig } from './models/user.model.js';
import { QuestionBlockModel } from './models/questionBlock.model.js';
import { SessionModel, type SessionDocument } from './models/session.model.js';
import type { SlotCode, SlotMode, QuestionType } from './types/core.js';
import { startSlotScheduler } from './scheduler/slotScheduler.js';
import { getOrCreateSessionForUserSlotDate } from './services/session.service.js';
import { ensureDefaultQuestionBlocksForUser } from './services/questionBlock.service.js';

// Validate required environment variables
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;

if (!botToken) {
  throw new Error(
    'TELEGRAM_BOT_TOKEN is not defined in the environment variables'
  );
}

if (!mongoUri) {
  throw new Error('MONGODB_URI is not defined in the environment variables');
}

// Explicitly assign validated environment variables
const validatedBotToken: string = botToken;
const validatedMongoUri: string = mongoUri;

// Default timezone for new users (will be configurable later)
const DEFAULT_TIMEZONE = 'Europe/Kyiv';

// Flag to ensure scheduler is started only once
let schedulerStarted = false;
const pendingResetConfirmation = new Set<number>();

function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function slotCodeFromString(value: string): SlotCode | null {
  const upper = value.toUpperCase();
  if (upper === 'MORNING') return 'MORNING';
  if (upper === 'DAY') return 'DAY';
  if (upper === 'EVENING') return 'EVENING';
  return null;
}

function getDateKeyForTimezone(timezone: string): string {
  const nowUtc = new Date();

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(nowUtc);
  const get = (type: string) => {
    const part = parts.find((p) => p.type === type);
    if (!part) {
      throw new Error(`Failed to parse "${type}" for timezone ${timezone}`);
    }
    return part.value;
  };

  const year = get('year');
  const month = get('month');
  const day = get('day');

  return `${year}-${month}-${day}`;
}

function questionTypeFromString(value: string): QuestionType | null {
  const upper = value.toUpperCase();
  if (upper === 'DAILY') return 'DAILY';
  if (upper === 'WEEKLY') return 'WEEKLY';
  if (upper === 'MONTHLY') return 'MONTHLY';
  return null;
}

type ParsedSlotInput =
  | { mode: Extract<SlotMode, 'FIXED'>; timeMinutes: number }
  | {
      mode: Extract<SlotMode, 'RANDOM_WINDOW'>;
      windowStartMinutes: number;
      windowEndMinutes: number;
    };

function parseSlotInput(raw: string): ParsedSlotInput | null {
  // Normalize common dash variants and trim extra spaces
  const normalized = raw.replace(/[–—]/g, '-').trim().toLowerCase();

  // Range format: HH:MM-HH:MM
  const rangeMatch = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(normalized);
  if (rangeMatch) {
    const startMinutes = parseTimeToMinutes(rangeMatch[1]);
    const endMinutes = parseTimeToMinutes(rangeMatch[2]);
    if (
      startMinutes === null ||
      endMinutes === null ||
      startMinutes >= endMinutes
    ) {
      return null;
    }
    return {
      mode: 'RANDOM_WINDOW',
      windowStartMinutes: startMinutes,
      windowEndMinutes: endMinutes,
    };
  }

  // Fixed time format: HH:MM
  const fixedMinutes = parseTimeToMinutes(normalized);
  if (fixedMinutes !== null) {
    return { mode: 'FIXED', timeMinutes: fixedMinutes };
  }

  return null;
}

function formatSlotSummary(slot: SlotConfig): string {
  const labels: Record<SlotCode, string> = {
    MORNING: 'Morning',
    DAY: 'Day',
    EVENING: 'Evening',
  };

  const label = labels[slot.slot] ?? slot.slot;

  if (slot.mode === 'FIXED' && typeof slot.timeMinutes === 'number') {
    return `${label}: fixed at ${formatMinutesToTime(slot.timeMinutes)}`;
  }

  if (
    slot.mode === 'RANDOM_WINDOW' &&
    typeof slot.windowStartMinutes === 'number' &&
    typeof slot.windowEndMinutes === 'number'
  ) {
    return (
      `${label}: random between ` +
      `${formatMinutesToTime(slot.windowStartMinutes)}–` +
      `${formatMinutesToTime(slot.windowEndMinutes)}`
    );
  }

  return `${label}: not configured`;
}

function formatSlotsForBlock(slots: {
  morning: boolean;
  day: boolean;
  evening: boolean;
}): string {
  const active: string[] = [];
  if (slots.morning) active.push('Morning');
  if (slots.day) active.push('Day');
  if (slots.evening) active.push('Evening');
  return active.length ? active.join(', ') : 'None';
}

function formatWeekdays(days?: number[]): string {
  if (!days || days.length === 0) return 'not set';
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days
    .map((d) => (d >= 1 && d <= 7 ? names[d - 1] : String(d)))
    .join(', ');
}

function formatMonthSchedule(
  schedule:
    | { kind: 'DAY_OF_MONTH' | 'FIRST_DAY' | 'LAST_DAY'; dayOfMonth?: number }
    | undefined
): string {
  if (!schedule) return 'not set';
  if (schedule.kind === 'FIRST_DAY') return 'first day of month';
  if (schedule.kind === 'LAST_DAY') return 'last day of month';
  if (schedule.kind === 'DAY_OF_MONTH' && schedule.dayOfMonth) {
    return `day ${schedule.dayOfMonth}`;
  }
  return 'not set';
}

function parseSlotsFlag(raw: string): { morning: boolean; day: boolean; evening: boolean } | null {
  const values = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  if (!values.length) return null;

  const flags = { morning: false, day: false, evening: false };
  for (const v of values) {
    if (v === 'morning') flags.morning = true;
    else if (v === 'day') flags.day = true;
    else if (v === 'evening') flags.evening = true;
  }

  if (!flags.morning && !flags.day && !flags.evening) return null;
  return flags;
}

function getPrimarySlotFromFlags(
  slots: { morning: boolean; day: boolean; evening: boolean }
): SlotCode {
  if (slots.morning) return 'MORNING';
  if (slots.day) return 'DAY';
  return 'EVENING';
}

function getSlotLabel(slot: SlotCode): string {
  switch (slot) {
    case 'MORNING':
      return 'Morning reflection';
    case 'DAY':
      return 'Day reflection';
    case 'EVENING':
      return 'Evening reflection';
  }
}

function buildQuestionPrompt(
  slot: SlotCode,
  questionText: string,
  index: number,
  total: number
): string {
  const label = getSlotLabel(slot);
  const progress = total > 1 ? ` (${index + 1}/${total})` : '';
  return `🧭 ${label}${progress}\n\n${questionText}`;
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getTimezoneMinutesNow(timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());

  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0';

  const hours = Number.parseInt(hourStr, 10);
  const minutes = Number.parseInt(minuteStr, 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

function pickNextSlotForReflection(
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

async function expireOldSessions(
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

async function getTodayActiveSessions(
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

function formatSessionExportText(sessions: SessionDocument[]): string {
  if (!sessions.length) return 'No answers found.';

  const lines: string[] = [];

  for (const session of sessions) {
    const label = getSlotLabel(session.slot);
    lines.push(`${session.dateKey} - ${label} (${session.status})`);

    if (!session.answers.length) {
      lines.push('  No answers recorded.');
      lines.push('');
      continue;
    }

    session.answers.forEach((answer, index) => {
      const question =
        session.questions.find((q) => q.key === answer.key) ||
        session.questions[index];
      const questionText = question?.text ?? `Question ${index + 1}`;
      lines.push(`  Q: ${questionText}`);
      lines.push(`  A: ${answer.text}`);
    });

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function buildSessionCompletionSummary(session: SessionDocument): string {
  const label = getSlotLabel(session.slot);
  const lines: string[] = [];

  lines.push(`✅ ${label} session completed for ${session.dateKey}.`);

  if (session.answers.length === 0) {
    lines.push('No answers were recorded.');
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Your answers:');

  session.answers.forEach((answer, index) => {
    const question =
      session.questions.find((q) => q.key === answer.key) ||
      session.questions[index];

    const questionText = question?.text ?? `Question ${index + 1}`;
    lines.push(`${index + 1}. ${questionText}`);
    lines.push(`-> ${answer.text}`);
  });

  return lines.join('\n');
}

async function replyWithSessionProgress(
  ctx: Context,
  session: SessionDocument
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
    await ctx.reply(buildSessionCompletionSummary(session));
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
    )
  );
}

function buildUpdatedSlotConfigs(
  currentSlots: SlotConfig[],
  updates: Record<SlotCode, ParsedSlotInput>
): SlotConfig[] {
  const defaultSlots: SlotCode[] = ['MORNING', 'DAY', 'EVENING'];

  return defaultSlots.map((slotCode) => {
    const existing = currentSlots.find((s) => s.slot === slotCode);

    const update = updates[slotCode];
    const base: SlotConfig =
      update.mode === 'FIXED'
        ? {
            slot: slotCode,
            mode: 'FIXED',
            timeMinutes: update.timeMinutes,
          }
        : {
            slot: slotCode,
            mode: 'RANDOM_WINDOW',
            windowStartMinutes: update.windowStartMinutes,
            windowEndMinutes: update.windowEndMinutes,
          };

    return {
      ...existing,
      ...base,
    };
  });
}

// Default slot configuration for a new user
function buildDefaultSlots(): SlotConfig[] {
  return [
    // MORNING — fixed test time (now + 2 minutes) for development
    {
      slot: 'MORNING',
      mode: 'FIXED',
      timeMinutes: 9 * 60, // 09:00 in production
    },

    // DAY — random between 13:00 and 15:00 (will be used later)
    {
      slot: 'DAY',
      mode: 'RANDOM_WINDOW',
      windowStartMinutes: 13 * 60, // 13:00
      windowEndMinutes: 15 * 60, // 15:00
    },

    // EVENING — fixed at 18:00
    {
      slot: 'EVENING',
      mode: 'FIXED',
      timeMinutes: 18 * 60, // 18:00
    },
  ];
}

// Connect to MongoDB
async function connectToDatabase(): Promise<void> {
  try {
    await mongoose.connect(validatedMongoUri);
    console.log('✅ MongoDB connection established');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

// Initialize Telegram bot
const bot = new Telegraf(validatedBotToken);

// Basic /start command handler
bot.start(async (ctx) => {
  try {
    const from = ctx.from;

    if (!from) {
      await ctx.reply(
        'Unable to read your Telegram profile. Please try again later.'
      );
      return;
    }

    const telegramId = from.id;
    const firstName = from.first_name ?? 'there';

    // Try to find existing user
    let user = await UserModel.findOne({ telegramId }).exec();

    if (!user) {
      // Create new user with default timezone and default slots
      user = await UserModel.create({
        telegramId,
        timezone: DEFAULT_TIMEZONE,
        slots: buildDefaultSlots(),
      });

      // Create default question blocks for this user
      await ensureDefaultQuestionBlocksForUser(user._id);

      await ctx.reply(
        `Hello, ${firstName}! 👋\n\n` +
          `I am Focus Mind — a Telegram bot for daily, weekly, and monthly self-reflection and productivity.\n\n` +
          `I have created your profile with default time slots:\n` +
          `• Morning: 09:00\n` +
          `• Day: random between 13:00–15:00\n` +
          `• Evening: 18:00\n\n` +
          `Later you will be able to customize your timezone and slot times in settings.`
      );
    } else {
      await ctx.reply(
        `Welcome back, ${firstName}! 👋\n\n` +
          `Your Focus Mind profile already exists.\n` +
          `Soon I will start sending you reflection sessions based on your configured slots and questions.`
      );
    }

    // Start slot scheduler once, after the first successful /start
    if (!schedulerStarted) {
      schedulerStarted = true;
      startSlotScheduler(bot);
      console.log('🕒 Slot scheduler started after first /start');
    }
  } catch (error) {
    console.error('Error in /start handler:', error);
    await ctx.reply(
      'Something went wrong while initializing your profile. Please try again later.'
    );
  }
});

bot.command('help', async (ctx) => {
  const lines = [
    'Available commands:',
    '/start - Create profile and show intro',
    '/help - Show this list',
    '/settings - View timezone and slot schedule',
    '/timezone <IANA TZ> - Change your timezone',
    '/slots <M> <D> <E> - Configure daily slots (HH:MM or HH:MM-HH:MM)',
    '/daily /weekly /monthly - Configure question sets quickly',
    "/today - Show today's reflection sessions status",
    '/reflect [skip] - Start or resume a reflection session (use "skip" to jump to the latest slot today)',
    '/export [json|text] - Export your answers',
    '/history - Recent reflection history',
    '/reset - Reset all Focus Mind data (with confirmation)',
    '/session_start SLOT [YYYY-MM-DD] - Manual session start',
    '/questions_set ... - Advanced question setup',
  ];

  await ctx.reply(lines.join('\n'));
});

// Debug command to test session building logic for today (MORNING slot)
bot.command('debug_today_session', async (ctx) => {
  try {
    const from = ctx.from;

    if (!from) {
      await ctx.reply(
        'Unable to read your Telegram profile. Please try again later.'
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

    // For now we just test MORNING slot and "today"
    const slot: SlotCode = 'MORNING';

    const today = new Date();
    const dateKey = today.toISOString().slice(0, 10); // "YYYY-MM-DD" (UTC-based)

    const session = await getOrCreateSessionForUserSlotDate(
      user._id,
      slot,
      dateKey
    );

    const lines: string[] = [];

    lines.push(`🧪 Debug session for ${slot} on ${dateKey}`);
    lines.push(`Status: ${session.status}`);
    lines.push(`Questions count: ${session.questions.length}`);

    if (session.questions.length > 0) {
      lines.push('');
      lines.push('Questions:');
      for (const q of session.questions) {
        lines.push(`- [${q.sourceType}] ${q.text}`);
      }
    }

    await ctx.reply(lines.join('\n'));
  } catch (error) {
    console.error('Error in /debug_today_session handler:', error);
    await ctx.reply(
      'Error while building debug session. Please try again later.'
    );
  }
});

// Command to manually start or resume a session for a slot/date
bot.command('session_start', async (ctx) => {
  try {
    const messageText = ctx.message?.text ?? '';
    const parts = messageText.trim().split(/\s+/).slice(1);
    const rawSlot = parts[0];
    const rawDate = parts[1];

    if (!rawSlot) {
      await ctx.reply(
        'Usage: /session_start SLOT [YYYY-MM-DD]\nExamples:\n- /session_start EVENING\n- /session_start MORNING 2025-12-31'
      );
      return;
    }

    const slot = slotCodeFromString(rawSlot);
    if (!slot) {
      await ctx.reply('Unknown slot. Use MORNING, DAY, or EVENING.');
      return;
    }

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

    let dateKey = rawDate;
    if (dateKey) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        await ctx.reply('Date must be in YYYY-MM-DD format, e.g. 2025-12-31.');
        return;
      }
    } else {
      dateKey = getDateKeyForTimezone(user.timezone || DEFAULT_TIMEZONE);
    }

    const session = await getOrCreateSessionForUserSlotDate(
      user._id,
      slot,
      dateKey
    );

    await replyWithSessionProgress(ctx, session);
  } catch (error) {
    console.error('Error in /session_start handler:', error);
    await ctx.reply('Failed to start session. Please try again later.');
  }
});

bot.command('reflect', async (ctx) => {
  try {
    const [, argRaw] = (ctx.message?.text ?? '').trim().split(/\s+/, 2);
    const skipPrevious =
      (argRaw ?? '').toLowerCase() === 'skip' ||
      (argRaw ?? '').toLowerCase() === 'current';

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

    const timezone = user.timezone || DEFAULT_TIMEZONE;
    const todayKey = await expireOldSessions(user._id, timezone);
    const todaySessions = await getTodayActiveSessions(user._id, todayKey);

    let session: SessionDocument | null = null;

    if (todaySessions.length) {
      if (skipPrevious && todaySessions.length > 1) {
        const toSkipIds = todaySessions.slice(0, -1).map((s) => s._id);
        await SessionModel.updateMany(
          { _id: { $in: toSkipIds } },
          { status: 'skipped' }
        ).exec();
        session = todaySessions[todaySessions.length - 1];
      } else {
        session = todaySessions[0];
      }
    }

    if (!session) {
      const nowMinutes = getTimezoneMinutesNow(timezone);
      const slot = pickNextSlotForReflection(user.slots, nowMinutes);

      if (!slot) {
        await ctx.reply(
          'Slots are not configured yet. Use /slots to set them up.'
        );
        return;
      }

      const dateKey = getDateKeyForTimezone(timezone);
      session = await getOrCreateSessionForUserSlotDate(
        user._id,
        slot,
        dateKey
      );
    }

    await replyWithSessionProgress(ctx, session);
  } catch (error) {
    console.error('Error in /reflect handler:', error);
    await ctx.reply('Failed to start reflection. Please try again later.');
  }
});

// Command to update MORNING/DAY/EVENING slot times at once
bot.command('set_slots_time', async (ctx) => {
  const messageText = ctx.message?.text ?? '';
  const parts = messageText.trim().split(/\s+/).slice(1); // skip command itself

  if (parts.length < 3) {
    await ctx.reply(
      'Please provide three values for morning/day/evening slots.\n' +
        '- Fixed time: HH:MM (e.g. 08:30)\n' +
        '- Random window: HH:MM-HH:MM (e.g. 13:00-15:00)\n' +
        'Example: /set_slots_time 08:30 13:00-15:00 20:15'
    );
    return;
  }

  const [morningRaw, dayRaw, eveningRaw] = parts;
  const morningParsed = parseSlotInput(morningRaw);
  const dayParsed = parseSlotInput(dayRaw);
  const eveningParsed = parseSlotInput(eveningRaw);

  if (!morningParsed || !dayParsed || !eveningParsed) {
    await ctx.reply('Could not parse input. Use HH:MM or HH:MM-HH:MM formats.');
    return;
  }

  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply('Create a profile first using /start');
    return;
  }

  user.slots = buildUpdatedSlotConfigs(user.slots ?? [], {
    MORNING: morningParsed,
    DAY: dayParsed,
    EVENING: eveningParsed,
  });

  await user.save();

  await ctx.reply(
    'Done! Updated slot settings:\n' +
      `- ${formatSlotSummary(user.slots.find((s) => s.slot === 'MORNING')!)}` +
      `\n- ${formatSlotSummary(user.slots.find((s) => s.slot === 'DAY')!)}` +
      `\n- ${formatSlotSummary(user.slots.find((s) => s.slot === 'EVENING')!)}`
  );
});

bot.command('slots', async (ctx) => {
  const messageText = ctx.message?.text ?? '';
  const parts = messageText.trim().split(/\s+/).slice(1);

  if (parts.length < 3) {
    await ctx.reply(
      'Configure morning/day/evening times.\n' +
        'Use HH:MM for fixed or HH:MM-HH:MM for a random window.\n' +
        'Example: /slots 08:30 13:00-15:00 20:15'
    );
    return;
  }

  const [morningRaw, dayRaw, eveningRaw] = parts;
  const morningParsed = parseSlotInput(morningRaw);
  const dayParsed = parseSlotInput(dayRaw);
  const eveningParsed = parseSlotInput(eveningRaw);

  if (!morningParsed || !dayParsed || !eveningParsed) {
    await ctx.reply('Could not parse input. Use HH:MM or HH:MM-HH:MM formats.');
    return;
  }

  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply('Create a profile first using /start');
    return;
  }

  user.slots = buildUpdatedSlotConfigs(user.slots ?? [], {
    MORNING: morningParsed,
    DAY: dayParsed,
    EVENING: eveningParsed,
  });

  await user.save();

  await ctx.reply(
    'Saved. Updated slot settings:\n' +
      `- ${formatSlotSummary(user.slots.find((s) => s.slot === 'MORNING')!)}` +
      `\n- ${formatSlotSummary(user.slots.find((s) => s.slot === 'DAY')!)}` +
      `\n- ${formatSlotSummary(user.slots.find((s) => s.slot === 'EVENING')!)}`
  );
});

// Command to create/update a question block for a slot
bot.command('questions_set', async (ctx) => {
  const messageText = ctx.message?.text ?? '';
  const withoutCommand = messageText.replace(/^\/questions_set\s*/, '');
  const tokens = withoutCommand.trim().split(/\s+/);

  if (tokens.length < 2) {
    await ctx.reply(
      'Usage: /questions_set TYPE SLOT Question1 | Question2 | Question3 [--days=1,5] [--month=first|last|day:15] [--slots=morning,day] [--name=CustomName]\n' +
        'Examples:\n' +
        '- /questions_set DAILY MORNING What is your focus? | How do you feel?\n' +
        '- /questions_set WEEKLY EVENING Weekly review? | Main challenge? --days=5 --slots=evening\n' +
        '- /questions_set MONTHLY MORNING Plan month? | Key habits? --month=first --slots=morning,evening'
    );
    return;
  }

  const typeToken = tokens[0];
  const slotToken = tokens[1];
  const type = questionTypeFromString(typeToken);
  const slot = slotCodeFromString(slotToken);

  if (!type || !slot) {
    await ctx.reply(
      'Unknown TYPE or SLOT. TYPE: DAILY|WEEKLY|MONTHLY. SLOT: MORNING|DAY|EVENING.'
    );
    return;
  }

  const remainder = withoutCommand.replace(
    new RegExp(`^${tokens[0]}\\s+${tokens[1]}\\s*`),
    ''
  );
  const segments = remainder.split(/\s--/);
  const questionSegment = segments.shift()?.trim() ?? '';
  const flags = segments
    .map((s) => s.replace(/^--/, '').trim())
    .filter(Boolean);

  const questions = questionSegment
    .split('|')
    .map((q) => q.trim())
    .filter((q) => q.length > 0);

  if (questions.length === 0 || questions.length > 3) {
    await ctx.reply('Provide 1 to 3 questions separated by "|".');
    return;
  }

  let daysOfWeek: number[] | undefined;
  let monthSchedule:
    | { kind: 'DAY_OF_MONTH' | 'FIRST_DAY' | 'LAST_DAY'; dayOfMonth?: number }
    | undefined;
  let nameOverride: string | undefined;
  let slotsOverride: { morning: boolean; day: boolean; evening: boolean } | undefined;

  for (const flag of flags) {
    if (flag.startsWith('days=')) {
      const rawDays = flag.slice('days='.length);
      const parsed = rawDays
        .split(',')
        .map((d) => Number.parseInt(d.trim(), 10))
        .filter((n) => !Number.isNaN(n) && n >= 1 && n <= 7);
      if (parsed.length === 0) {
        await ctx.reply('days flag must contain numbers 1-7, e.g. --days=1,5');
        return;
      }
      daysOfWeek = parsed;
    } else if (flag.startsWith('month=')) {
      const raw = flag.slice('month='.length).toLowerCase();
      if (raw === 'first') {
        monthSchedule = { kind: 'FIRST_DAY' };
      } else if (raw === 'last') {
        monthSchedule = { kind: 'LAST_DAY' };
      } else if (raw.startsWith('day:')) {
        const dayNum = Number.parseInt(raw.slice(4), 10);
        if (Number.isNaN(dayNum) || dayNum < 1 || dayNum > 28) {
          await ctx.reply(
            'month flag day value must be between 1 and 28, e.g. --month=day:10'
          );
          return;
        }
        monthSchedule = { kind: 'DAY_OF_MONTH', dayOfMonth: dayNum };
      } else {
        await ctx.reply(
          'month flag must be first|last|day:N, e.g. --month=day:10'
        );
        return;
      }
    } else if (flag.startsWith('slots=')) {
      const parsed = parseSlotsFlag(flag.slice('slots='.length));
      if (!parsed) {
        await ctx.reply(
          'slots flag must contain morning, day, evening separated by commas. Example: --slots=morning,evening'
        );
        return;
      }
      slotsOverride = parsed;
    } else if (flag.startsWith('name=')) {
      nameOverride = flag.slice('name='.length).trim();
    }
  }

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

  const slotFlags = {
    morning: slot === 'MORNING',
    day: slot === 'DAY',
    evening: slot === 'EVENING',
  };
  const effectiveSlots = slotsOverride ?? slotFlags;

  if (!effectiveSlots.morning && !effectiveSlots.day && !effectiveSlots.evening) {
    await ctx.reply(
      'At least one slot must be selected. Use SLOT argument or --slots flag.'
    );
    return;
  }

  // Try to find existing block for this user/type/slot
  const slotQueryKeys = ['morning', 'day', 'evening'].filter(
    (key) => (effectiveSlots as Record<string, boolean>)[key]
  );

  const existing = await QuestionBlockModel.findOne({
    userId: user._id,
    type,
    ...(slotQueryKeys.length
      ? { $or: slotQueryKeys.map((key) => ({ [`slots.${key}`]: true })) }
      : { [`slots.${slot.toLowerCase()}`]: true }),
  }).exec();

  const blockName =
    nameOverride ||
    existing?.name ||
    `${
      type === 'DAILY' ? 'Daily' : type === 'WEEKLY' ? 'Weekly' : 'Monthly'
    } ${getPrimarySlotFromFlags(effectiveSlots).toLowerCase()}`;

  const baseQuestions = questions.map((text, index) => ({
    key: `q${index + 1}`,
    text,
    order: index,
  }));

  if (existing) {
    existing.name = blockName;
    existing.slots = effectiveSlots;
    existing.questions = baseQuestions;

    if (type === 'WEEKLY') {
      existing.daysOfWeek = daysOfWeek ?? existing.daysOfWeek ?? [1];
    } else {
      existing.daysOfWeek = undefined;
    }

    if (type === 'MONTHLY') {
      existing.monthSchedule = monthSchedule ??
        existing.monthSchedule ?? { kind: 'LAST_DAY' };
    } else {
      existing.monthSchedule = undefined;
    }

    await existing.save();
  } else {
    await QuestionBlockModel.create({
      userId: user._id,
      type,
      name: blockName,
      slots: effectiveSlots,
      questions: baseQuestions,
      daysOfWeek: type === 'WEEKLY' ? daysOfWeek ?? [1] : undefined,
      monthSchedule:
        type === 'MONTHLY' ? monthSchedule ?? { kind: 'LAST_DAY' } : undefined,
    });
  }

  const summaryLines = [
    'Saved question block:',
    `[${type}] ${blockName}`,
    `Slot: ${slot}`,
  ];

  if (type === 'WEEKLY') {
    summaryLines.push(
      `Days: ${formatWeekdays(daysOfWeek ?? existing?.daysOfWeek ?? [1])}`
    );
  }

  if (type === 'MONTHLY') {
    summaryLines.push(
      `Month schedule: ${formatMonthSchedule(
        monthSchedule ?? existing?.monthSchedule ?? { kind: 'LAST_DAY' }
      )}`
    );
  }

  summaryLines.push('Questions:');
  questions.forEach((q) => summaryLines.push(`- ${q}`));

  await ctx.reply(summaryLines.join('\n'));
});

bot.command(['daily', 'weekly', 'monthly'], async (ctx) => {
  const command =
    ctx.message?.text?.split(/\s+/)[0]?.replace('/', '') ?? 'daily';
  const type = command.toUpperCase() as QuestionType;
  const from = ctx.from;

  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply('You do not have a FocusMind profile yet. Send /start first.');
    return;
  }

  const blocks = await QuestionBlockModel.find({ userId: user._id, type })
    .sort({ createdAt: 1 })
    .exec();

  if (!blocks.length) {
    const templates: Record<QuestionType, string> = {
      DAILY: '/questions_set DAILY MORNING What is your focus? | How do you feel?',
      WEEKLY: '/questions_set WEEKLY EVENING Weekly review? | Main challenge? --days=5',
      MONTHLY: '/questions_set MONTHLY MORNING Plan month? | Key habits? --month=last',
    };

    await ctx.reply(
      `No ${type.toLowerCase()} question sets yet.\nCreate one:\n${templates[type]}`
    );
    return;
  }

  const lines: string[] = [];
  lines.push(`Your ${type.toLowerCase()} question sets:`);

  const pickPrimarySlot = (
    slots: { morning: boolean; day: boolean; evening: boolean }
  ): SlotCode => {
    if (slots.morning) return 'MORNING';
    if (slots.day) return 'DAY';
    return 'EVENING';
  };

  for (const block of blocks) {
    lines.push('');
    lines.push(`[${block.name}]`);
    lines.push(`Slots: ${formatSlotsForBlock(block.slots)}`);

    if (type === 'WEEKLY') {
      lines.push(`Days: ${formatWeekdays(block.daysOfWeek)}`);
    }

    if (type === 'MONTHLY') {
      lines.push(`Month schedule: ${formatMonthSchedule(block.monthSchedule)}`);
    }

    const questions = [...block.questions].sort((a, b) => a.order - b.order);
    if (questions.length) {
      lines.push('Questions:');
      questions.forEach((q, idx) => lines.push(`${idx + 1}. ${q.text}`));
    } else {
      lines.push('Questions: none yet');
    }

    const slotForUpdate = pickPrimarySlot(block.slots);
    const slotsFlag = ['morning', 'day', 'evening']
      .filter((k) => (block.slots as Record<string, boolean>)[k])
      .join(',');

    const extraFlags: string[] = [];
    if (slotsFlag) extraFlags.push(`--slots=${slotsFlag}`);
    if (type === 'WEEKLY' && block.daysOfWeek?.length) {
      extraFlags.push(`--days=${block.daysOfWeek.join(',')}`);
    }
    if (type === 'MONTHLY' && block.monthSchedule) {
      const ms = block.monthSchedule;
      if (ms.kind === 'FIRST_DAY') extraFlags.push('--month=first');
      else if (ms.kind === 'LAST_DAY') extraFlags.push('--month=last');
      else if (ms.kind === 'DAY_OF_MONTH' && ms.dayOfMonth) {
        extraFlags.push(`--month=day:${ms.dayOfMonth}`);
      }
    }

    const flagsStr = extraFlags.length ? ' ' + extraFlags.join(' ') : '';
    lines.push(
      `Change this set: /questions_set ${type} ${slotForUpdate} Question1 | Question2 | Question3${flagsStr}`
    );
  }

  await ctx.reply(lines.join('\n'));
});

// Command to show current settings: timezone and slot timings
bot.command('settings', async (ctx) => {
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

  const slotOrder: SlotCode[] = ['MORNING', 'DAY', 'EVENING'];
  const summaries = slotOrder.map((code) => {
    const slot = user.slots?.find((s) => s.slot === code);
    if (!slot) {
      return `${code}: not configured`;
    }
    return formatSlotSummary(slot);
  });

  const lines = [
    'Your current settings:',
    `- Timezone: ${user.timezone}`,
    ...summaries.map((s) => `- ${s}`),
  ];

  await ctx.reply(lines.join('\n'));
});

bot.command('timezone', async (ctx) => {
  const [, tz] = (ctx.message?.text ?? '').trim().split(/\s+/, 2);

  if (!tz) {
    await ctx.reply('Usage: /timezone Europe/Kyiv');
    return;
  }

  if (!isValidTimezone(tz)) {
    await ctx.reply(
      'Unknown timezone. Please provide a valid IANA timezone like Europe/Kyiv or America/New_York.'
    );
    return;
  }

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

  user.timezone = tz;
  await user.save();

  await ctx.reply(`Timezone updated to ${tz}.`);
});

// Command to list user's question blocks
bot.command('questions', async (ctx) => {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const [, maybeTypeRaw] = (ctx.message?.text ?? '').trim().split(/\s+/);
  const filterType = maybeTypeRaw ? questionTypeFromString(maybeTypeRaw) : null;

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const blocks = await QuestionBlockModel.find({ userId: user._id })
    .sort({ type: 1, createdAt: 1 })
    .exec();

  const filtered = filterType
    ? blocks.filter((b) => b.type === filterType)
    : blocks;

  if (!filtered.length) {
    await ctx.reply('No question blocks found for your profile.');
    return;
  }

  const lines: string[] = [];
  lines.push(
    filterType
      ? `Your ${filterType.toLowerCase()} question blocks:`
      : 'Your question blocks:'
  );

  for (const block of filtered) {
    lines.push('');
    lines.push(`[${block.type}] ${block.name}`);
    lines.push(`Slots: ${formatSlotsForBlock(block.slots)}`);

    if (block.type === 'WEEKLY') {
      lines.push(`Days: ${formatWeekdays(block.daysOfWeek)}`);
    }

    if (block.type === 'MONTHLY') {
      lines.push(`Month schedule: ${formatMonthSchedule(block.monthSchedule)}`);
    }

    lines.push('Questions:');
    for (const q of block.questions.sort((a, b) => a.order - b.order)) {
      lines.push(`- ${q.text}`);
    }
  }

  await ctx.reply(lines.join('\n'));
});

bot.command('export', async (ctx) => {
  const [, modeRaw] = (ctx.message?.text ?? '').trim().split(/\s+/, 2);
  const mode = modeRaw?.toLowerCase() === 'json' ? 'json' : 'text';

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

  const sessions = await SessionModel.find({ userId: user._id })
    .sort({ dateKey: -1, slot: 1 })
    .limit(50)
    .exec();

  if (!sessions.length) {
    await ctx.reply('No reflection answers to export yet.');
    return;
  }

  const sendInChunks = async (payload: string) => {
    const maxLen = 3500;
    for (let i = 0; i < payload.length; i += maxLen) {
      await ctx.reply(payload.slice(i, i + maxLen));
    }
  };

  if (mode === 'json') {
    const exportData = {
      user: {
        timezone: user.timezone,
        slots: user.slots,
      },
      sessions: sessions.map((s) => ({
        dateKey: s.dateKey,
        slot: s.slot,
        status: s.status,
        questions: s.questions,
        answers: s.answers,
        startedAt: s.startedAt,
        finishedAt: s.finishedAt,
        lastInteractionAt: s.lastInteractionAt,
      })),
    };

    const json = JSON.stringify(exportData, null, 2);
    await sendInChunks('Here is your data (JSON):\n```\n' + json + '\n```');
    return;
  }

  const textExport = formatSessionExportText(sessions);
  await sendInChunks('Here is your data (text):\n' + textExport);
});

bot.command('reset', async (ctx) => {
  const [, confirm] = (ctx.message?.text ?? '').trim().split(/\s+/, 2);
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  if (confirm?.toLowerCase() !== 'confirm') {
    pendingResetConfirmation.add(from.id);
    await ctx.reply(
      'This will delete all your Focus Mind data (profile, slots, questions, sessions).\n' +
        'If you want to proceed, send /reset confirm'
    );
    return;
  }

  if (!pendingResetConfirmation.has(from.id)) {
    await ctx.reply(
      'Please run /reset first, then confirm with /reset confirm.'
    );
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    pendingResetConfirmation.delete(from.id);
    await ctx.reply('No profile found to reset.');
    return;
  }

  await Promise.all([
    SessionModel.deleteMany({ userId: user._id }).exec(),
    QuestionBlockModel.deleteMany({ userId: user._id }).exec(),
    UserModel.deleteOne({ _id: user._id }).exec(),
  ]);

  pendingResetConfirmation.delete(from.id);
  await ctx.reply(
    'All your Focus Mind data has been reset. You can start again with /start.'
  );
});

bot.command('today', async (ctx) => {
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

  const timezone = user.timezone || DEFAULT_TIMEZONE;
  const dateKey = getDateKeyForTimezone(timezone);
  const sessions = await SessionModel.find({
    userId: user._id,
    dateKey,
  })
    .sort({ slot: 1 })
    .exec();

  if (!sessions.length) {
    await ctx.reply('No reflections for today yet. Use /reflect to begin.');
    return;
  }

  const lines = [`Status for ${dateKey}:`];

  for (const session of sessions) {
    const label = getSlotLabel(session.slot);
    lines.push(`- ${label}: ${session.status}`);
  }

  await ctx.reply(lines.join('\n'));
});

bot.command('history', async (ctx) => {
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

  const sessions = await SessionModel.find({ userId: user._id })
    .sort({ dateKey: -1, slot: 1 })
    .limit(10)
    .exec();

  if (!sessions.length) {
    await ctx.reply('No reflection history yet.');
    return;
  }

  const lines = ['Recent reflections:'];
  for (const session of sessions) {
    const label = getSlotLabel(session.slot);
    lines.push(`- ${session.dateKey} ${label}: ${session.status}`);
  }

  await ctx.reply(lines.join('\n'));
});

// Text messages are treated as answers to an active session
bot.on('text', async (ctx) => {
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

    const timezone = user.timezone || DEFAULT_TIMEZONE;
    const todayKey = await expireOldSessions(user._id, timezone);

    const session = await SessionModel.findOne({
      userId: user._id,
      dateKey: todayKey,
      status: { $in: ['pending', 'in_progress'] },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();

    if (!session || !session.questions.length) {
      await ctx.reply(
        'No active reflection session right now. Use /session_start SLOT to begin one.'
      );
      return;
    }

    const currentIndex = session.currentQuestionIndex ?? 0;

    if (currentIndex >= session.questions.length) {
      session.status = 'completed';
      session.finishedAt ||= new Date();
      session.lastInteractionAt = new Date();
      await session.save();
      await ctx.reply(buildSessionCompletionSummary(session));
      return;
    }

    const question = session.questions[currentIndex];
    const answerText = (ctx.message?.text ?? '').trim();

    if (!answerText) {
      await ctx.reply('Send a text answer to continue your reflection.');
      return;
    }

    const now = new Date();
    session.answers = session.answers.filter((a) => a.key !== question.key);
    session.answers.push({
      key: question.key,
      text: answerText,
      createdAt: now,
    });
    session.currentQuestionIndex = currentIndex + 1;
    session.status =
      session.currentQuestionIndex >= session.questions.length
        ? 'completed'
        : 'in_progress';
    session.lastInteractionAt = now;
    session.startedAt ||= now;

    if (session.status === 'completed') {
      session.finishedAt = now;
      await session.save();
      await ctx.reply(buildSessionCompletionSummary(session));
      return;
    }

    const nextQuestion = session.questions[session.currentQuestionIndex];

    if (!nextQuestion) {
      session.status = 'completed';
      session.finishedAt = now;
      await session.save();
      await ctx.reply(buildSessionCompletionSummary(session));
      return;
    }

    await session.save();

    await ctx.reply(
      '✅ Saved your answer.\n\n' +
        buildQuestionPrompt(
          session.slot,
          nextQuestion.text,
          session.currentQuestionIndex,
          session.questions.length
        )
    );
  } catch (error) {
    console.error('Error while handling text message:', error);
    await ctx.reply(
      'Something went wrong while processing your answer. Please try again.'
    );
  }
});

// Application bootstrap
async function bootstrap(): Promise<void> {
  await connectToDatabase();
  await bot.launch();
  console.log('🤖 Focus Mind bot is up and running');
}

// Graceful shutdown handling
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  void mongoose.disconnect();
});

process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  void mongoose.disconnect();
});

// Start application
void bootstrap();
