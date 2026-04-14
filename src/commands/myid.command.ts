import type { Context, Telegraf } from 'telegraf';

import { buildTelegramProfileBlock } from '../utils/telegramProfile.js';

export function registerMyIdCommand(bot: Telegraf): void {
  bot.command(['myid', 'whoami'], async (ctx: Context) => {
    const from = ctx.from;

    if (!from) {
      await ctx.reply('Unable to read your Telegram profile. Please try again.');
      return;
    }

    await ctx.reply(buildTelegramProfileBlock(from), {
      parse_mode: 'HTML',
    });
  });
}
