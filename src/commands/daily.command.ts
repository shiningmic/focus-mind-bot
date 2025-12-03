import type { Context, Telegraf } from 'telegraf';

import type { QuestionType } from '../types/core.js';
import { handleBlocksList } from '../flows/blocks.js';

export function registerDailyCommand(bot: Telegraf): void {
  bot.command('daily', async (ctx: Context) => {
    await handleBlocksList(ctx, 'DAILY');
  });
}
