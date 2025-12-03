import type { Context, Telegraf } from 'telegraf';

import { DEFAULT_TIMEZONE } from '../config/constants.js';
import { SessionModel } from '../models/session.model.js';
import { UserModel } from '../models/user.model.js';
import { getSlotLabel } from '../utils/format.js';
import { getDateKeyForTimezone } from '../utils/time.js';

export function registerTodayCommand(bot: Telegraf): void {
  bot.command('today', async (ctx: Context) => {
    const from = ctx.from;
    if (!from) {
      await ctx.reply('Unable to read your Telegram profile. Please try again.');
      return;
    }

    const user = await UserModel.findOne({ telegramId: from.id }).exec();
    if (!user) {
      await ctx.reply(
        'You do not have a Focus Mind profile yet. Send /start first.'
      );
      return;
    }

    const timezone = user.timezone || DEFAULT_TIMEZONE;
    const dateKey = getDateKeyForTimezone(timezone);
    const sessions = await SessionModel.find({
      userId: user._id,
      dateKey,
    })
      .sort({ slot: 1 })
      .exec();

    if (!sessions.length) {
      await ctx.reply('No reflections for today yet. Use /reflect to begin.');
      return;
    }

    const lines = [`Status for ${dateKey}:`];

    for (const session of sessions) {
      const label = getSlotLabel(session.slot);
      lines.push(`- ${label}: ${session.status}`);
    }

    await ctx.reply(lines.join('\n'));
  });
}
