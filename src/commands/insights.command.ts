import type { Context, Telegraf } from 'telegraf';

import OpenAI from 'openai';
import type { ResponseOutputMessage } from 'openai/resources/responses/responses.js';
import { SessionModel } from '../models/session.model.js';
import { UserModel } from '../models/user.model.js';
import { DEFAULT_TIMEZONE } from '../config/constants.js';
import type { SlotCode } from '../types/core.js';

type InsightsRange = 'daily' | 'week' | 'month';

const slotOrder: Record<SlotCode, number> = {
  MORNING: 0,
  DAY: 1,
  EVENING: 2,
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const insightsLastCall = new Map<string, number>();
const INSIGHTS_MIN_INTERVAL_MS = 1 * 60 * 1000;

export function registerInsightsCommand(bot: Telegraf): void {
  bot.command('insights', async (ctx: Context) => {
    try {
      const messageText =
        'text' in (ctx.message ?? {}) ? ((ctx.message as any).text ?? '') : '';
      const [, rangeRaw] = messageText.trim().split(/\s+/, 2);

      const range = normalizeRange(rangeRaw);
      const days = range === 'daily' ? 1 : range === 'month' ? 30 : 7;

      const from = ctx.from;
      if (!from) {
        await ctx.reply(
          'Unable to read your Telegram profile. Please try again.',
        );
        return;
      }

      const user = await UserModel.findOne({ telegramId: from.id }).exec();
      if (!user) {
        await ctx.reply(
          'You do not have a Focus Mind profile yet. Send /start first.',
        );
        return;
      }

      const now = Date.now();
      const lastCall = insightsLastCall.get(String(user._id));
      if (lastCall && now - lastCall < INSIGHTS_MIN_INTERVAL_MS) {
        const waitSec = Math.ceil(
          (INSIGHTS_MIN_INTERVAL_MS - (now - lastCall)) / 1000,
        );
        await ctx.reply(
          `Please wait ${waitSec}s before requesting insights again.`,
        );
        return;
      }

      if (!process.env.OPENAI_API_KEY) {
        await ctx.reply(
          'Insights are not configured yet. Please set OPENAI_API_KEY.',
        );
        return;
      }

      const timezone = user.timezone || DEFAULT_TIMEZONE;
      const dateKeys = getDateKeysForPastDays(timezone, days);

      const sessions = await SessionModel.find({
        userId: user._id,
        dateKey: { $in: dateKeys },
        status: { $in: ['completed'] },
      })
        .sort({ dateKey: 1, slot: 1 })
        .lean()
        .exec();

      if (!sessions.length) {
        await ctx.reply('No completed reflections found for this period.');
        return;
      }

      const inputText = buildInsightsInput(sessions);
      const model = process.env.OPENAI_MODEL_INSIGHTS || 'gpt-4o-mini';

      const response = await openai.responses.create({
        model,
        input: [
          {
            role: 'system',
            content:
              'You are an assistant that summarizes reflection answers into short, actionable insights. ' +
              'Keep it concise, neutral, and supportive. Avoid therapy or medical claims.',
          },
          {
            role: 'user',
            content:
              `Generate a short insight for the past ${days} day(s). ` +
              'Output 3-5 bullet points and one short "Next action" line. ' +
              'Do not include headings.\n\n' +
              inputText,
          },
        ],
        temperature: 0.3,
      });

      const output =
        (response as any).output_text ??
        extractOutputText(response.output) ??
        '';

      if (!output.trim()) {
        await ctx.reply('Failed to generate insights. Please try again.');
        return;
      }

      insightsLastCall.set(String(user._id), Date.now());
      await ctx.reply(output.trim());
    } catch (error) {
      console.error('Error in /insights handler:', error);
      await ctx.reply('Failed to generate insights. Please try again later.');
    }
  });
}

function extractOutputText(
  output: Array<{ type: string }> | undefined,
): string | null {
  if (!output) return null;
  for (const item of output) {
    if (item.type === 'message') {
      const message = item as ResponseOutputMessage;
      for (const content of message.content ?? []) {
        if (content.type === 'output_text') {
          return content.text ?? null;
        }
      }
    }
  }
  return null;
}

function normalizeRange(value?: string): InsightsRange {
  const v = (value ?? '').toLowerCase();
  if (v === 'daily' || v === 'day') return 'daily';
  if (v === 'month' || v === 'monthly') return 'month';
  return 'week';
}

function getDateKeysForPastDays(timezone: string, days: number): string[] {
  const keys = new Set<string>();
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);

    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';

    const year = get('year');
    const month = get('month');
    const day = get('day');
    if (year && month && day) {
      keys.add(`${year}-${month}-${day}`);
    }
  }

  return Array.from(keys);
}

function buildInsightsInput(
  sessions: Array<{
    dateKey: string;
    slot: SlotCode;
    questions: Array<{ key: string; text: string }>;
    answers: Array<{ key: string; text: string }>;
  }>,
): string {
  const lines: string[] = [];
  const grouped = new Map<string, typeof sessions>();

  for (const session of sessions) {
    const list = grouped.get(session.dateKey) ?? [];
    list.push(session);
    grouped.set(session.dateKey, list);
  }

  const sortedDates = [...grouped.keys()].sort();
  for (const dateKey of sortedDates) {
    lines.push(`Date: ${dateKey}`);
    const daySessions = grouped
      .get(dateKey)!
      .sort((a, b) => slotOrder[a.slot] - slotOrder[b.slot]);

    for (const session of daySessions) {
      lines.push(`Slot: ${session.slot}`);
      for (const answer of session.answers) {
        const question =
          session.questions.find((q) => q.key === answer.key) ??
          session.questions[0];
        const questionText = question?.text ?? 'Question';
        lines.push(`Q: ${questionText}`);
        lines.push(`A: ${answer.text}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}
