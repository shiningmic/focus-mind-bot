import type { Context, Telegraf } from 'telegraf';

import { DEFAULT_TIMEZONE } from '../config/constants.js';
import type { SlotCode } from '../types/core.js';
import { getDateKeyForTimezone, slotCodeFromString } from '../utils/time.js';
import { UserModel } from '../models/user.model.js';
import { getOrCreateSessionForUserSlotDate } from '../services/session.service.js';
import { replyWithSessionProgress } from '../services/sessionWorkflow.service.js';

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
}
