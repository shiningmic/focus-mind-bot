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
    '/slots <M> <D> <E> - Configure daily slots (HH:MM or HH:MM-HH:MM)',
    '/daily /weekly /monthly - Configure question sets quickly',
    "/today - Show today's reflection sessions status",
    '/reflect [skip] - Start or resume a reflection session (use "skip" to jump to the latest slot today)',
    '/export [json|text] - Export your answers',
    '/history - Recent reflection history',
    '/reset - Reset all Focus Mind data (with confirmation)',
    '',
    'What Focus Mind can do:',
    '- Guide daily, weekly, and monthly reflections',
    '- Let you customize slots and timezone for reminders',
    '- Store answers with history, export, and reset options',
    '- Run manual sessions and tailor questions to your routine',
    '',
    'How it works:',
    '- Slots: up to 3 reminder times (Morning, Day, Evening) in your timezone',
    '- Question sets: max 3 daily, 3 weekly, and 3 monthly sets',
    '- Each set can have up to 3 questions shown during its slot(s)',
    '- Weekly sets can target specific weekdays; monthly sets can target month schedules',
    '- You can adjust timezone and slot times anytime via /slots',
  ];

  await ctx.reply(lines.join('\n'), buildSettingKeyboard());
}
