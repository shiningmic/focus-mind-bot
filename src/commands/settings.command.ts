import type { Context, Telegraf } from 'telegraf';

import { UserModel, type SlotConfig } from '../models/user.model.js';
import { QuestionBlockModel } from '../models/questionBlock.model.js';
import type { QuestionType, SlotCode } from '../types/core.js';
import {
  formatSlotSummary,
  formatSlotsForBlock,
  formatWeekdays,
  formatMonthSchedule,
} from '../utils/format.js';
import { buildSettingsKeyboard } from '../ui/keyboards.js';

export async function sendSettings(ctx: Context): Promise<void> {
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

  const blocks = await QuestionBlockModel.find({ userId: user._id })
    .sort({ type: 1, createdAt: 1 })
    .lean()
    .exec();

  const blocksByType: Record<QuestionType, typeof blocks> = {
    DAILY: [],
    WEEKLY: [],
    MONTHLY: [],
  };
  for (const b of blocks) {
    blocksByType[b.type as QuestionType].push(b);
  }

  const lines = ['Your current settings:'];

  const slotMap = new Map<SlotCode, SlotConfig>(
    (user.slots ?? []).map((s) => [s.slot, s])
  );

  const morningSummary = slotMap.get('MORNING')
    ? formatSlotSummary(slotMap.get('MORNING')!)
    : 'Morning: not configured';
  const daySummary = slotMap.get('DAY')
    ? formatSlotSummary(slotMap.get('DAY')!)
    : 'Day: not configured';
  const eveningSummary = slotMap.get('EVENING')
    ? formatSlotSummary(slotMap.get('EVENING')!)
    : 'Evening: not configured';

  lines.push(
    `- ${morningSummary}`,
    `- ${daySummary}`,
    `- ${eveningSummary}`,
    `- Timezone: ${user.timezone}`,
    '',
    'Configured question blocks:'
  );

  const formatQuestions = (qs: { order: number; text: string }[]) =>
    qs
      .sort((a, b) => a.order - b.order)
      .map((q, idx) => `${idx + 1}. ${q.text}`)
      .join('\n');

  const pushBlocks = (
    type: QuestionType,
    title: string,
    extra: (b: any) => string | null = () => null
  ) => {
    const order: Array<'morning' | 'day' | 'evening'> = [
      'morning',
      'day',
      'evening',
    ];
    const list = [...blocksByType[type]].sort((a, b) => {
      const aSlotIndex = order.findIndex((s) => (a.slots as any)[s]);
      const bSlotIndex = order.findIndex((s) => (b.slots as any)[s]);
      const aIdx = aSlotIndex === -1 ? order.length : aSlotIndex;
      const bIdx = bSlotIndex === -1 ? order.length : bSlotIndex;
      return aIdx - bIdx;
    });
    lines.push(title);
    if (!list.length) {
      lines.push('- none');
      lines.push('');
      return;
    }
    for (const block of list) {
      lines.push(`- ${block.name}`);
      lines.push(`  Slots: ${formatSlotsForBlock(block.slots)}`);
      const extraLine = extra(block);
      if (extraLine) lines.push(`  ${extraLine}`);
      const qText = formatQuestions(block.questions ?? []);
      lines.push(
        qText
          ? `  Questions:\n${qText
              .split('\n')
              .map((l) => '    ' + l)
              .join('\n')}`
          : '  Questions: none'
      );
      lines.push('');
    }
  };

  pushBlocks('DAILY', 'Daily blocks:');
  pushBlocks('WEEKLY', 'Weekly blocks:', (b) =>
    b.daysOfWeek?.length ? `Days: ${formatWeekdays(b.daysOfWeek)}` : null
  );
  pushBlocks('MONTHLY', 'Monthly blocks:', (b) =>
    b.monthSchedule ? `Schedule: ${formatMonthSchedule(b.monthSchedule)}` : null
  );

  await ctx.reply(lines.join('\n'), buildSettingsKeyboard());
}

export function registerSettingsCommand(bot: Telegraf): void {
  bot.command('settings', async (ctx: Context) => {
    await sendSettings(ctx);
  });
}
