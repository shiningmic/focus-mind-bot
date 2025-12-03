import type { Context, Telegraf } from 'telegraf';

import { handleBlocksList } from '../flows/blocks.js';

export function registerMonthlyCommand(bot: Telegraf): void {
  bot.command('monthly', async (ctx: Context) => {
    await handleBlocksList(ctx, 'MONTHLY');
  });
}
