// src/index.ts
import 'dotenv/config';
import { Telegraf } from 'telegraf';
import mongoose from 'mongoose';

import { UserModel, type SlotConfig } from './models/user.model.js';
import { SlotCode } from './types/core.js';
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

// Default slot configuration for a new user
// Default slot configuration for a new user
function buildDefaultSlots(): SlotConfig[] {
  return [
    // MORNING — fixed at 09:00
    {
      slot: 'MORNING',
      mode: 'FIXED',
      timeMinutes: 9 * 60, // 09:00
    },

    // DAY — random between 13:00 and 15:00
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
          `Your Focus Mind profile already exists.\n` +
          `Soon I will start sending you reflection sessions based on your configured slots and questions.`
      );
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

// Temporary fallback handler for any text message
bot.on('text', async (ctx) => {
  await ctx.reply(
    'I am running, but reflection sessions are not enabled yet.\nThey will be available soon 🙂'
  );
});

// Application bootstrap
async function bootstrap(): Promise<void> {
  await connectToDatabase();

  // Start the bot using long polling
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
