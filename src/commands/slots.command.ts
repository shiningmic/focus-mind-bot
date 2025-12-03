import type { Context, Telegraf } from 'telegraf';

import { handleSlotsCommand } from '../flows/slots.js';

export function registerSlotsCommand(bot: Telegraf): void {
  bot.command('slots', async (ctx: Context) => {
    await handleSlotsCommand(ctx);
  });
}
