import type { Context, Telegraf } from 'telegraf';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import type { QuestionType, SlotCode } from '../types/core.js';
import {
  formatMonthSchedule,
  formatWeekdays,
} from '../utils/format.js';
import {
  questionTypeFromString,
  slotCodeFromString,
} from '../utils/time.js';
import { getPrimarySlotFromFlags, parseSlotsFlag } from '../utils/slots.js';
import { UserModel } from '../models/user.model.js';

export function registerQuestionsSetCommand(bot: Telegraf): void {
  bot.command('questions_set', async (ctx: Context) => {
    const messageText =
      'text' in (ctx.message ?? {}) ? (ctx.message as any).text ?? '' : '';
    const withoutCommand = messageText.replace(/^\/questions_set\s*/, '');
    const tokens = withoutCommand.trim().split(/\s+/);

    if (tokens.length < 2) {
      await ctx.reply(
        'Usage: /questions_set TYPE SLOT Question1 | Question2 | Question3 [--days=1,5] [--month=first|last|day:15] [--slots=morning,day] [--name=CustomName]\n' +
          'Examples:\n' +
          '- /questions_set DAILY MORNING What is your focus? | How do you feel?\n' +
          '- /questions_set WEEKLY EVENING Weekly review? | Main challenge? --days=5 --slots=evening\n' +
          '- /questions_set MONTHLY MORNING Plan month? | Key habits? --month=first --slots=morning,evening'
      );
      return;
    }

    const typeToken = tokens[0];
    const slotToken = tokens[1];
    const type = questionTypeFromString(typeToken);
    const slot = slotCodeFromString(slotToken);

    if (!type || !slot) {
      await ctx.reply(
        'Unknown TYPE or SLOT. TYPE: DAILY|WEEKLY|MONTHLY. SLOT: MORNING|DAY|EVENING.'
      );
      return;
    }

    const remainder = withoutCommand.replace(
      new RegExp(`^${tokens[0]}\\s+${tokens[1]}\\s*`),
      ''
    );
    const segments: string[] = remainder.split(/\s--/);
    const questionSegment = segments.shift()?.trim() ?? '';
    const flags = segments
      .map((s: string) => s.replace(/^--/, '').trim())
      .filter(Boolean);

    const questions = questionSegment
      .split('|')
      .map((q: string) => q.trim())
      .filter((q: string) => q.length > 0);

    if (questions.length === 0 || questions.length > 3) {
      await ctx.reply('Provide 1 to 3 questions separated by "|".');
      return;
    }

    let daysOfWeek: number[] | undefined;
    let monthSchedule:
      | {
          kind: 'DAY_OF_MONTH' | 'FIRST_DAY' | 'LAST_DAY';
          dayOfMonth?: number;
        }
      | undefined;
    let nameOverride: string | undefined;
    let slotsOverride:
      | { morning: boolean; day: boolean; evening: boolean }
      | undefined;

    for (const flag of flags) {
      if (flag.startsWith('days=')) {
        const rawDays = flag.slice('days='.length);
        const parsed = rawDays
          .split(',')
          .map((d: string) => Number.parseInt(d.trim(), 10))
          .filter((n: number) => !Number.isNaN(n) && n >= 1 && n <= 7);
        if (parsed.length === 0) {
          await ctx.reply('days flag must contain numbers 1-7, e.g. --days=1,5');
          return;
        }
        daysOfWeek = parsed;
      } else if (flag.startsWith('month=')) {
        const raw = flag.slice('month='.length).toLowerCase();
        if (raw === 'first') {
          monthSchedule = { kind: 'FIRST_DAY' };
        } else if (raw === 'last') {
          monthSchedule = { kind: 'LAST_DAY' };
        } else if (raw.startsWith('day:')) {
          const dayNum = Number.parseInt(raw.slice(4), 10);
          if (Number.isNaN(dayNum) || dayNum < 1 || dayNum > 28) {
            await ctx.reply(
              'month flag day value must be between 1 and 28, e.g. --month=day:10'
            );
            return;
          }
          monthSchedule = { kind: 'DAY_OF_MONTH', dayOfMonth: dayNum };
        } else {
          await ctx.reply(
            'month flag must be first|last|day:N, e.g. --month=day:10'
          );
          return;
        }
      } else if (flag.startsWith('slots=')) {
        const parsed = parseSlotsFlag(flag.slice('slots='.length));
        if (!parsed) {
          await ctx.reply(
            'slots flag must contain morning, day, evening separated by commas. Example: --slots=morning,evening'
          );
          return;
        }
        slotsOverride = parsed;
      } else if (flag.startsWith('name=')) {
        nameOverride = flag.slice('name='.length).trim();
      }
    }

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

    const slotFlags = {
      morning: slot === 'MORNING',
      day: slot === 'DAY',
      evening: slot === 'EVENING',
    };
    const effectiveSlots = slotsOverride ?? slotFlags;

    if (
      !effectiveSlots.morning &&
      !effectiveSlots.day &&
      !effectiveSlots.evening
    ) {
      await ctx.reply(
        'At least one slot must be selected. Use SLOT argument or --slots flag.'
      );
      return;
    }

    const slotQueryKeys = ['morning', 'day', 'evening'].filter(
      (key) => (effectiveSlots as Record<string, boolean>)[key]
    );

    const existing = await QuestionBlockModel.findOne({
      userId: user._id,
      type,
      ...(slotQueryKeys.length
        ? { $or: slotQueryKeys.map((key) => ({ [`slots.${key}`]: true })) }
        : { [`slots.${slot.toLowerCase()}`]: true }),
    }).exec();

    const blockName =
      nameOverride ||
      existing?.name ||
      `${
        type === 'DAILY' ? 'Daily' : type === 'WEEKLY' ? 'Weekly' : 'Monthly'
      } ${getPrimarySlotFromFlags(effectiveSlots).toLowerCase()}`;

    const baseQuestions = questions.map((text: string, index: number) => ({
      key: `q${index + 1}`,
      text,
      order: index,
    }));

    if (existing) {
      existing.name = blockName;
      existing.slots = effectiveSlots;
      existing.questions = baseQuestions;

      if (type === 'WEEKLY') {
        existing.daysOfWeek = daysOfWeek ?? existing.daysOfWeek ?? [1];
      } else {
        existing.daysOfWeek = undefined;
      }

      if (type === 'MONTHLY') {
        existing.monthSchedule =
          monthSchedule ?? existing.monthSchedule ?? { kind: 'LAST_DAY' };
      } else {
        existing.monthSchedule = undefined;
      }

      await existing.save();
    } else {
      await QuestionBlockModel.create({
        userId: user._id,
        type,
        name: blockName,
        slots: effectiveSlots,
        questions: baseQuestions,
        daysOfWeek: type === 'WEEKLY' ? daysOfWeek ?? [1] : undefined,
        monthSchedule:
          type === 'MONTHLY' ? monthSchedule ?? { kind: 'LAST_DAY' } : undefined,
      });
    }

    const summaryLines = [
      'Saved question block:',
      `[${type}] ${blockName}`,
      `Slot: ${slot}`,
    ];

    if (type === 'WEEKLY') {
      summaryLines.push(
        `Days: ${formatWeekdays(daysOfWeek ?? existing?.daysOfWeek ?? [1])}`
      );
    }

    if (type === 'MONTHLY') {
      summaryLines.push(
        `Month schedule: ${formatMonthSchedule(
          monthSchedule ?? existing?.monthSchedule ?? { kind: 'LAST_DAY' }
        )}`
      );
    }

    summaryLines.push('Questions:');
    questions.forEach((q: string) => summaryLines.push(`- ${q}`));

    await ctx.reply(summaryLines.join('\n'));
  });
}
