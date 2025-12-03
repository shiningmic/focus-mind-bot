import type { Context, Telegraf } from 'telegraf';

import { buildSettingKeyboard } from '../ui/keyboards.js';

export function registerHelpCommand(bot: Telegraf): void {
  bot.command('help', async (ctx: Context) => {
    await sendHelp(ctx);
  });
}

export async function sendHelp(ctx: Context): Promise<void> {
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
    '',
    'What Focus Mind can do:',
    '- Guide daily, weekly, and monthly reflections',
    '- Let you customize slots and timezone for reminders',
    '- Store answers with history, export, and reset options',
    '- Run manual sessions and tailor questions to your routine',
  ];

  await ctx.reply(lines.join('\n'), buildSettingKeyboard());
}
