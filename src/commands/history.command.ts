import type { Context, Telegraf } from 'telegraf';

import { SessionModel } from '../models/session.model.js';
import { UserModel } from '../models/user.model.js';
import { getSlotLabel } from '../utils/format.js';

export function registerHistoryCommand(bot: Telegraf): void {
  bot.command('history', async (ctx: Context) => {
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

    const sessions = await SessionModel.find({ userId: user._id })
      .sort({ dateKey: -1, slot: 1 })
      .limit(10)
      .exec();

    if (!sessions.length) {
      await ctx.reply('No reflection history yet.');
      return;
    }

    const lines = ['Recent reflections:'];
    for (const session of sessions) {
      const label = getSlotLabel(session.slot);
      lines.push(`- ${session.dateKey} ${label}: ${session.status}`);
    }

    await ctx.reply(lines.join('\n'));
  });
}
