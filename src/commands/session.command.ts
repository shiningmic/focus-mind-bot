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
import type { SlotCode } from '../types/core.js';
import {
  getDateKeyForTimezone,
  getTimezoneMinutesNow,
  slotCodeFromString,
} from '../utils/time.js';

export function registerSessionCommands(bot: Telegraf): void {
  bot.command('debug_today_session', async (ctx: Context) => {
    try {
      const from = ctx.from;

      if (!from) {
        await ctx.reply(
          'Unable to read your Telegram profile. Please try again later.'
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

      const slot: SlotCode = 'MORNING';

      const today = new Date();
      const dateKey = today.toISOString().slice(0, 10);

      const session = await getOrCreateSessionForUserSlotDate(
        user._id,
        slot,
        dateKey
      );

      const lines: string[] = [];

      lines.push(`?? Debug session for ${slot} on ${dateKey}`);
      lines.push(`Status: ${session.status}`);
      lines.push(`Questions count: ${session.questions.length}`);

      if (session.questions.length > 0) {
        lines.push('');
        lines.push('Questions:');
        for (const q of session.questions) {
          lines.push(`- [${q.sourceType}] ${q.text}`);
        }
      }

      await ctx.reply(lines.join('\n'));
    } catch (error) {
      console.error('Error in /debug_today_session handler:', error);
      await ctx.reply(
        'Error while building debug session. Please try again later.'
      );
    }
  });

  bot.command('session_start', async (ctx: Context) => {
    try {
      const messageText =
        'text' in (ctx.message ?? {}) ? (ctx.message as any).text ?? '' : '';
      const parts = messageText.trim().split(/\s+/).slice(1);
      const rawSlot = parts[0];
      const rawDate = parts[1];

      if (!rawSlot) {
        await ctx.reply(
          'Usage: /session_start SLOT [YYYY-MM-DD]\nExamples:\n- /session_start EVENING\n- /session_start MORNING 2025-12-31'
        );
        return;
      }

      const slot = slotCodeFromString(rawSlot);
      if (!slot) {
        await ctx.reply('Unknown slot. Use MORNING, DAY, or EVENING.');
        return;
      }

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

      let dateKey = rawDate;
      if (dateKey) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          await ctx.reply(
            'Date must be in YYYY-MM-DD format, e.g. 2025-12-31.'
          );
          return;
        }
      } else {
        dateKey = getDateKeyForTimezone(user.timezone || DEFAULT_TIMEZONE);
      }

      const session = await getOrCreateSessionForUserSlotDate(
        user._id,
        slot,
        dateKey
      );

      await replyWithSessionProgress(ctx, session);
    } catch (error) {
      console.error('Error in /session_start handler:', error);
      await ctx.reply('Failed to start session. Please try again later.');
    }
  });

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
        const nowMinutes = getTimezoneMinutesNow(timezone);
        const slot = pickNextSlotForReflection(
          user.slots as SlotConfig[] | undefined,
          nowMinutes
        );

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
