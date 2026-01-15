import type { Context } from 'telegraf';

import type { QuestionType, SlotCode } from '../types/core.js';
import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { UserModel } from '../models/user.model.js';
import {
  buildDailyKeyboard,
  buildMonthlyKeyboard,
  buildSettingsKeyboard,
  buildWeeklyKeyboard,
} from '../ui/keyboards.js';
import {
  formatMonthSchedule,
  formatSlotsForBlock,
  formatWeekdays,
} from '../utils/format.js';

export async function handleBlocksList(
  ctx: Context,
  type: QuestionType
): Promise<void> {
  const from = ctx.from;

  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a FocusMind profile yet. Send /start first.'
    );
    return;
  }

  const blocks = await QuestionBlockModel.find({ userId: user._id, type })
    .sort({ createdAt: 1 })
    .exec();

  if (!blocks.length) {
    const keyboard =
      type === 'DAILY'
        ? buildDailyKeyboard([])
        : type === 'WEEKLY'
        ? buildWeeklyKeyboard([])
        : buildMonthlyKeyboard([]);
    await ctx.reply(
      `No ${type.toLowerCase()} question sets yet.\nUse the add button below to create one.`,
      keyboard
    );
    return;
  }

  const lines: string[] = [];
  lines.push(`Your ${type.toLowerCase()} question sets:`);

  const pickPrimarySlot = (slots: {
    morning: boolean;
    day: boolean;
    evening: boolean;
  }): SlotCode => {
    if (slots.morning) return 'MORNING';
    if (slots.day) return 'DAY';
    return 'EVENING';
  };

  const slotOrder: SlotCode[] = ['MORNING', 'DAY', 'EVENING'];
  const sortedBlocks = [...blocks].sort((a, b) => {
    const aSlot = pickPrimarySlot(a.slots);
    const bSlot = pickPrimarySlot(b.slots);
    const aIdx = slotOrder.indexOf(aSlot);
    const bIdx = slotOrder.indexOf(bSlot);
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.name.localeCompare(b.name);
  });

  for (const block of sortedBlocks) {
    lines.push('');
    lines.push(`[${block.name}]`);
    lines.push(`Slots: ${formatSlotsForBlock(block.slots)}`);

    if (type === 'WEEKLY') {
      lines.push(`Days: ${formatWeekdays(block.daysOfWeek)}`);
    }

    if (type === 'MONTHLY') {
      lines.push(`Month schedule: ${formatMonthSchedule(block.monthSchedule)}`);
    }

    const questions = [...block.questions].sort((a, b) => a.order - b.order);
    if (questions.length) {
      lines.push('Questions:');
      questions.forEach((q, idx) => lines.push(`${idx + 1}. ${q.text}`));
    } else {
      lines.push('Questions: none yet');
    }

    const slotForUpdate = pickPrimarySlot(block.slots);
    const slotsFlag = ['morning', 'day', 'evening']
      .filter((k) => (block.slots as Record<string, boolean>)[k])
      .join(',');

    const extraFlags: string[] = [];
    if (slotsFlag) extraFlags.push(`--slots=${slotsFlag}`);
    if (type === 'WEEKLY' && block.daysOfWeek?.length) {
      extraFlags.push(`--days=${block.daysOfWeek.join(',')}`);
    }
    if (type === 'MONTHLY' && block.monthSchedule) {
      const ms = block.monthSchedule;
      if (ms.kind === 'FIRST_DAY') extraFlags.push('--month=first');
      else if (ms.kind === 'LAST_DAY') extraFlags.push('--month=last');
      else if (ms.kind === 'DAY_OF_MONTH' && ms.dayOfMonth) {
        extraFlags.push(`--month=day:${ms.dayOfMonth}`);
      }
    }
  }

  const keyboard =
    type === 'DAILY'
      ? buildDailyKeyboard(sortedBlocks)
      : type === 'WEEKLY'
      ? buildWeeklyKeyboard(sortedBlocks)
      : type === 'MONTHLY'
      ? buildMonthlyKeyboard(sortedBlocks)
      : buildSettingsKeyboard();
  await ctx.reply(lines.join('\n'), keyboard);
}
