import type { Context, Telegraf } from 'telegraf';

import { SessionModel } from '../models/session.model.js';
import { UserModel } from '../models/user.model.js';
import {
  formatSessionExportByQuestion,
  formatSessionExportText,
} from '../utils/format.js';

export function registerExportCommand(bot: Telegraf): void {
  bot.command('export', async (ctx: Context) => {
    const messageText =
      'text' in (ctx.message ?? {}) ? (ctx.message as any).text ?? '' : '';
    const [, arg1Raw, arg2Raw] = messageText.trim().split(/\s+/, 3);
    const arg1 = arg1Raw?.toLowerCase();
    const arg2 = arg2Raw?.toLowerCase();
    const groupMode =
      arg1 === 'byd' || arg1 === 'date'
        ? 'date'
        : arg1 === 'byq' || arg1 === 'questions'
        ? 'questions'
        : 'questions';
    const mode =
      arg1 === 'json' || arg2 === 'json'
        ? 'json'
        : arg1 === 'txt' || arg2 === 'txt'
        ? 'txt'
        : 'text';

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
      const filename = `focus-mind-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      await ctx.replyWithDocument({
        source: Buffer.from(json, 'utf8'),
        filename,
      });
      return;
    }

    if (mode === 'txt') {
      const filename = `focus-mind-export-${new Date()
        .toISOString()
        .slice(0, 10)}.txt`;
      const textPlain =
        groupMode === 'questions'
          ? formatSessionExportByQuestion(sessions, { markdown: false })
          : formatSessionExportText(sessions, { markdown: false });
      const payload = `Here is your data:\n${textPlain}\n`;
      await ctx.replyWithDocument({
        source: Buffer.from(payload, 'utf8'),
        filename,
      });
      return;
    }

    const header = 'Here is your data:';
    const textMarkdown =
      groupMode === 'questions'
        ? formatSessionExportByQuestion(sessions, { markdown: true })
        : formatSessionExportText(sessions, { markdown: true });
    await sendInChunks(`${header}\n${textMarkdown}`, 'MarkdownV2');
  });
}
