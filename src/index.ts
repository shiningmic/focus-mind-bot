import 'dotenv/config';
import { Telegraf } from 'telegraf';
import mongoose from 'mongoose';

import { UserModel, type SlotConfig } from './models/user.model.js';
import type { SlotCode, SlotMode } from './types/core.js';
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
          `I am FocusMind — a Telegram bot for daily, weekly, and monthly self-reflection and productivity.\n\n` +
          `I have created your profile with default time slots:\n` +
          `• Morning: 09:00\n` +
          `• Day: random between 13:00–15:00\n` +
          `• Evening: 18:00\n\n` +
          `Later you will be able to customize your timezone and slot times in settings.`
      );
    } else {
      await ctx.reply(
        `Welcome back, ${firstName}! 👋\n\n` +
          `Your FocusMind profile already exists.\n` +
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
        'You do not have a FocusMind profile yet. Send /start first.'
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
      'You do not have a FocusMind profile yet. Send /start first.'
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

// Temporary fallback handler for any text message
bot.on('text', async (ctx) => {
  await ctx.reply(
    'I am running, but reflection sessions are still in development.\nThey will be available soon 🙂'
  );
});

// Application bootstrap
async function bootstrap(): Promise<void> {
  await connectToDatabase();
  await bot.launch();
  console.log('🤖 FocusMind bot is up and running');
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
