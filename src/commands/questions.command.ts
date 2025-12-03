import type { Context, Telegraf } from 'telegraf';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { UserModel } from '../models/user.model.js';
import {
  formatMonthSchedule,
  formatSlotsForBlock,
  formatWeekdays,
} from '../utils/format.js';
import { questionTypeFromString } from '../utils/time.js';

export function registerQuestionsCommand(bot: Telegraf): void {
  bot.command('questions', async (ctx: Context) => {
    const from = ctx.from;
    if (!from) {
      await ctx.reply('Unable to read your Telegram profile. Please try again.');
      return;
    }

    const messageText =
      'text' in (ctx.message ?? {}) ? (ctx.message as any).text ?? '' : '';
    const [, maybeTypeRaw] = messageText.trim().split(/\s+/);
    const filterType = maybeTypeRaw ? questionTypeFromString(maybeTypeRaw) : null;

    const user = await UserModel.findOne({ telegramId: from.id }).exec();
    if (!user) {
      await ctx.reply(
        'You do not have a Focus Mind profile yet. Send /start first.'
      );
      return;
    }

    const blocks = await QuestionBlockModel.find({ userId: user._id })
      .sort({ type: 1, createdAt: 1 })
      .exec();

    const filtered = filterType
      ? blocks.filter((b) => b.type === filterType)
      : blocks;

    if (!filtered.length) {
      await ctx.reply('No question blocks found for your profile.');
      return;
    }

    const lines: string[] = [];
    lines.push(
      filterType
        ? `Your ${filterType.toLowerCase()} question blocks:`
        : 'Your question blocks:'
    );

    for (const block of filtered) {
      lines.push('');
      lines.push(`[${block.type}] ${block.name}`);
      lines.push(`Slots: ${formatSlotsForBlock(block.slots)}`);

      if (block.type === 'WEEKLY') {
        lines.push(`Days: ${formatWeekdays(block.daysOfWeek)}`);
      }

      if (block.type === 'MONTHLY') {
        lines.push(`Month schedule: ${formatMonthSchedule(block.monthSchedule)}`);
      }

      lines.push('Questions:');
      for (const q of block.questions.sort((a, b) => a.order - b.order)) {
        lines.push(`- ${q.text}`);
      }
    }

    await ctx.reply(lines.join('\n'));
  });
}
