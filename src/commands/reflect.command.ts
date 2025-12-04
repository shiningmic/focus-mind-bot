import type { Context, Telegraf } from 'telegraf';

import { DEFAULT_TIMEZONE } from '../config/constants.js';
import { SessionModel, type SessionDocument } from '../models/session.model.js';
import { UserModel, type SlotConfig } from '../models/user.model.js';
import { getOrCreateSessionForUserSlotDate } from '../services/session.service.js';
import {
  expireOldSessions,
  getTodayActiveSessions,
  pickNextSlotForReflection,
  replyWithSessionProgress,
} from '../services/sessionWorkflow.service.js';
import { getDateKeyForTimezone, getTimezoneMinutesNow } from '../utils/time.js';

export function registerReflectCommand(bot: Telegraf): void {
  bot.command('reflect', async (ctx: Context) => {
    try {
      const messageText =
        'text' in (ctx.message ?? {}) ? (ctx.message as any).text ?? '' : '';
      const [, argRaw] = messageText.trim().split(/\s+/, 2);
      const skipPrevious =
        (argRaw ?? '').toLowerCase() === 'skip' ||
        (argRaw ?? '').toLowerCase() === 'current';

      const from = ctx.from;
      if (!from) {
        await ctx.reply(
          'Unable to read your Telegram profile. Please try again.'
        );
        return;
      }

      const user = await UserModel.findOne({ telegramId: from.id }).exec();
      if (!user) {
        await ctx.reply(
          'You do not have a Focus Mind profile yet. Send /start first.'
        );
        return;
      }

      const configuredSlots = (user.slots as SlotConfig[] | undefined) ?? [];
      if (!configuredSlots.length) {
        await ctx.reply(
          'Slots are not configured yet. Use /slots to set them up.'
        );
        return;
      }

      const timezone = user.timezone || DEFAULT_TIMEZONE;
      const todayKey = await expireOldSessions(user._id, timezone);
      const todaySessions = await getTodayActiveSessions(user._id, todayKey);

      let session: SessionDocument | null = null;

      if (todaySessions.length) {
        if (skipPrevious && todaySessions.length > 1) {
          const toSkipIds = todaySessions.slice(0, -1).map((s) => s._id);
          await SessionModel.updateMany(
            { _id: { $in: toSkipIds } },
            { status: 'skipped' }
          ).exec();
          session = todaySessions[todaySessions.length - 1];
        } else {
          session = todaySessions[0];
        }
      }

      if (!session) {
        // Determine if there are any unfinished slots for today
        const finishedToday = await SessionModel.find({
          userId: user._id,
          dateKey: todayKey,
          status: { $in: ['completed', 'skipped'] },
        }).exec();

        const finishedSlots = new Set(finishedToday.map((s) => s.slot));
        const remainingSlots = configuredSlots.filter(
          (s) => !finishedSlots.has(s.slot)
        );

        if (!remainingSlots.length) {
          await ctx.reply(
            'All reflections for today are completed. Use /history to review your answers.'
          );
          return;
        }

        const nowMinutes = getTimezoneMinutesNow(timezone);
        const slot = pickNextSlotForReflection(remainingSlots, nowMinutes);

        if (!slot) {
          await ctx.reply(
            'Slots are not configured yet. Use /slots to set them up.'
          );
          return;
        }

        const dateKey = getDateKeyForTimezone(timezone);
        session = await getOrCreateSessionForUserSlotDate(
          user._id,
          slot,
          dateKey
        );
      }

      await replyWithSessionProgress(ctx, session);
    } catch (error) {
      console.error('Error in /reflect handler:', error);
      await ctx.reply('Failed to start reflection. Please try again later.');
    }
  });
}
