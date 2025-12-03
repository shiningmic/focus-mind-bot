import type { Context, Telegraf } from 'telegraf';

import { buildMainKeyboard } from '../ui/keyboards.js';
import { isValidTimezone } from '../utils/time.js';
import { UserModel } from '../models/user.model.js';
import { DEFAULT_TIMEZONE } from '../config/constants.js';

export function registerTimezoneCommand(bot: Telegraf): void {
  bot.command('timezone', async (ctx: Context) => {
    const text =
      typeof ctx.message === 'object' &&
      ctx.message !== null &&
      'text' in ctx.message
        ? (ctx.message as { text?: string }).text ?? ''
        : '';
    const [, tz] = text.trim().split(/\s+/, 2);

    if (!tz) {
      await ctx.reply('Usage: /timezone Europe/Kyiv');
      return;
    }

    if (!isValidTimezone(tz)) {
      await ctx.reply(
        'Unknown timezone. Please provide a valid IANA timezone like Europe/Kyiv or America/New_York.'
      );
      return;
    }

    const from = ctx.from;
    if (!from) {
      await ctx.reply('Unable to read your Telegram profile. Please try again.');
      return;
    }

    const user = await UserModel.findOne({ telegramId: from.id }).exec();
    if (!user) {
      await ctx.reply(
        `You do not have a Focus Mind profile yet. Send /start first. Default timezone is ${DEFAULT_TIMEZONE}.`
      );
      return;
    }

    user.timezone = tz;
    await user.save();

    await ctx.reply(
      `Timezone updated to ${user.timezone}.`,
      buildMainKeyboard()
    );
  });
}
