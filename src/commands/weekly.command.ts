import type { Context, Telegraf } from 'telegraf';

import type { QuestionType } from '../types/core.js';
import { handleBlocksList } from '../flows/blocks.js';

export function registerWeeklyCommand(bot: Telegraf): void {
  bot.command('weekly', async (ctx: Context) => {
    await handleBlocksList(ctx, 'WEEKLY');
  });
}
