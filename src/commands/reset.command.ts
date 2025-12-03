import type { Context, Telegraf } from 'telegraf';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { SessionModel } from '../models/session.model.js';
import { UserModel } from '../models/user.model.js';

const pendingResetConfirmation = new Set<number>();

export function registerResetCommand(bot: Telegraf): void {
  bot.command('reset', async (ctx: Context) => {
    const messageText =
      'text' in (ctx.message ?? {}) ? (ctx.message as any).text ?? '' : '';
    const [, confirm] = messageText.trim().split(/\s+/, 2);
    const from = ctx.from;
    if (!from) {
      await ctx.reply('Unable to read your Telegram profile. Please try again.');
      return;
    }

    if (confirm?.toLowerCase() !== 'confirm') {
      pendingResetConfirmation.add(from.id);
      await ctx.reply(
        'This will delete all your Focus Mind data (profile, slots, questions, sessions).\n' +
          'If you want to proceed, send /reset confirm'
      );
      return;
    }

    if (!pendingResetConfirmation.has(from.id)) {
      await ctx.reply(
        'Please run /reset first, then confirm with /reset confirm.'
      );
      return;
    }

    const user = await UserModel.findOne({ telegramId: from.id }).exec();
    if (!user) {
      pendingResetConfirmation.delete(from.id);
      await ctx.reply('No profile found to reset.');
      return;
    }

    await Promise.all([
      SessionModel.deleteMany({ userId: user._id }).exec(),
      QuestionBlockModel.deleteMany({ userId: user._id }).exec(),
      UserModel.deleteOne({ _id: user._id }).exec(),
    ]);

    pendingResetConfirmation.delete(from.id);
    await ctx.reply(
      'All your Focus Mind data has been reset. You can start again with /start.'
    );
  });
}
