import 'dotenv/config';
import mongoose from 'mongoose';
import { Telegraf } from 'telegraf';

import { startSlotScheduler } from './scheduler/slotScheduler.js';
import { registerStartCommand } from './commands/start.command.js';
import { registerHelpCommand } from './commands/help.command.js';
import { registerSettingsCommand } from './commands/settings.command.js';
import { registerSlotsCommand } from './commands/slots.command.js';
import { registerTimezoneCommand } from './commands/timezone.command.js';
import { registerDailyCommand } from './commands/daily.command.js';
import { registerWeeklyCommand } from './commands/weekly.command.js';
import { registerMonthlyCommand } from './commands/monthly.command.js';
import { registerTodayCommand } from './commands/today.command.js';
import { registerQuestionsCommand } from './commands/questions.command.js';
import { registerQuestionsSetCommand } from './commands/questionsSet.command.js';
import { registerExportCommand } from './commands/export.command.js';
import { registerHistoryCommand } from './commands/history.command.js';
import { registerResetCommand } from './commands/reset.command.js';
import { registerSetSlotsTimeCommand } from './commands/setSlotsTime.command.js';
import { registerSessionCommands } from './commands/session.command.js';
import { registerReflectCommand } from './commands/reflect.command.js';
import { registerTextHandler } from './handlers/text.handler.js';

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

const validatedBotToken: string = botToken;
const validatedMongoUri: string = mongoUri;

async function connectToDatabase(): Promise<void> {
  try {
    await mongoose.connect(validatedMongoUri);
    console.log('✅ MongoDB connection established');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await connectToDatabase();

  const bot = new Telegraf(validatedBotToken);

  // Register commands
  registerStartCommand(bot);
  registerHelpCommand(bot);
  registerSettingsCommand(bot);
  registerSlotsCommand(bot);
  registerTimezoneCommand(bot);
  registerDailyCommand(bot);
  registerWeeklyCommand(bot);
  registerMonthlyCommand(bot);
  registerTodayCommand(bot);
  registerQuestionsCommand(bot);
  registerQuestionsSetCommand(bot);
  registerExportCommand(bot);
  registerHistoryCommand(bot);
  registerResetCommand(bot);
  registerSetSlotsTimeCommand(bot);
  registerReflectCommand(bot);
  registerSessionCommands(bot);

  // Single text handler entry point
  registerTextHandler(bot);

  // Start scheduler AFTER DB is ready
  startSlotScheduler(bot);

  await bot.launch();
  console.log('🤖 Focus Mind bot is up and running!');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
