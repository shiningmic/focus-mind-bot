import type { Context, Telegraf } from 'telegraf';

import { SessionModel } from '../models/session.model.js';
import { UserModel } from '../models/user.model.js';
import { formatSessionExportText } from '../utils/format.js';

export function registerExportCommand(bot: Telegraf): void {
  bot.command('export', async (ctx: Context) => {
    const messageText =
      'text' in (ctx.message ?? {}) ? (ctx.message as any).text ?? '' : '';
    const [, modeRaw] = messageText.trim().split(/\s+/, 2);
    const mode = modeRaw?.toLowerCase() === 'json' ? 'json' : 'text';

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

    const sessions = await SessionModel.find({ userId: user._id })
      .sort({ dateKey: -1, slot: 1 })
      .limit(50)
      .exec();

    if (!sessions.length) {
      await ctx.reply('No reflection answers to export yet.');
      return;
    }

    const sendInChunks = async (payload: string, parseMode?: 'MarkdownV2') => {
      const maxLen = 3500;
      if (!parseMode) {
        for (let i = 0; i < payload.length; i += maxLen) {
          await ctx.reply(payload.slice(i, i + maxLen));
        }
        return;
      }

      const lines = payload.split('\n');
      let chunk = '';
      for (const line of lines) {
        const next = chunk ? `${chunk}\n${line}` : line;
        if (next.length > maxLen && chunk) {
          await ctx.reply(chunk, { parse_mode: parseMode });
          chunk = line;
        } else {
          chunk = next;
        }
      }
      if (chunk) {
        await ctx.reply(chunk, { parse_mode: parseMode });
      }
    };

    if (mode === 'json') {
      const exportData = {
        user: {
          timezone: user.timezone,
          slots: user.slots,
        },
        sessions: sessions.map((s) => ({
          dateKey: s.dateKey,
          slot: s.slot,
          status: s.status,
          questions: s.questions,
          answers: s.answers,
          startedAt: s.startedAt,
          finishedAt: s.finishedAt,
          lastInteractionAt: s.lastInteractionAt,
        })),
      };

      const json = JSON.stringify(exportData, null, 2);
      await sendInChunks('Here is your data (JSON):\n```\n' + json + '\n```');
      return;
    }

    const textExport = formatSessionExportText(sessions);
    const header = 'Here is your data:';
    await sendInChunks(`${header}\n${textExport}`, 'MarkdownV2');
  });
}
