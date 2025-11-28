import 'dotenv/config';
import { Telegraf } from 'telegraf';
import mongoose from 'mongoose';

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
  const firstName = ctx.from?.first_name ?? 'there';

  await ctx.reply(
    `Hello, ${firstName}! 👋\n\n` +
      `I am Focus Mind — a Telegram bot for daily, weekly, and monthly self-reflection and productivity.\n\n` +
      `At this stage, I am just starting. Soon you will be able to configure time slots, questions, and reflection sessions.`
  );
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
