import type { Context } from 'telegraf';

import { buildMainKeyboard } from '../ui/keyboards.js';
import { formatSlotSummary } from '../utils/format.js';
import { parseSlotInput, isValidTimezone } from '../utils/time.js';
import { applySingleSlotUpdate, buildUpdatedSlotConfigs } from '../services/slots.service.js';
import { UserModel } from '../models/user.model.js';
import type { SlotCode } from '../types/core.js';

export async function handleSlotsCommand(
  ctx: Context,
  messageTextOverride?: string
): Promise<void> {
  const messageText =
    messageTextOverride ??
    (typeof ctx.message === 'object' &&
    ctx.message !== null &&
    'text' in ctx.message
      ? (ctx.message as { text?: string }).text ?? ''
      : '');
  const parts = messageText.trim().split(/\s+/).slice(1);

  const maybeTzCmd = parts[0]?.toLowerCase();
  const maybeTzValue = parts[1];

  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply('Create a profile first using /start');
    return;
  }

  if (
    (maybeTzCmd === 'tz' || maybeTzCmd === 'timezone') &&
    typeof maybeTzValue === 'string'
  ) {
    if (!isValidTimezone(maybeTzValue)) {
      await ctx.reply(
        'Unknown timezone. Please provide a valid IANA timezone like Europe/Kyiv or America/New_York.',
        buildMainKeyboard()
      );
      return;
    }

    user.timezone = maybeTzValue;
    await user.save();

    await ctx.reply(
      `Timezone updated to ${user.timezone}.\n\n` +
        'Configure morning/day/evening times.\n' +
        'Use HH:MM for fixed or HH:MM-HH:MM for a random window.\n' +
        'Example: /slots 08:30 13:00-15:00 20:15\n' +
        'Quick timezone change: /slots tz Europe/Kyiv',
      buildMainKeyboard()
    );
    return;
  }

  if (parts.length < 3) {
    const slotOrder: SlotCode[] = ['MORNING', 'DAY', 'EVENING'];
    const summaries = slotOrder.map((code) => {
      const slot = user.slots?.find((s) => s.slot === code);
      if (!slot) {
        return `${code}: not configured`;
      }
      return formatSlotSummary(slot);
    });

    const lines = [
      'Your current settings:',
      ...summaries.map((s) => `- ${s}`),
      `- Timezone: ${user.timezone}`,
      '',
      'Configure morning/day/evening times.',
      'Use HH:MM for fixed or HH:MM-HH:MM for a random window.',
      'Example: /slots 08:30 13:00-15:00 20:15',
      'Quick timezone change: /slots tz Europe/Kyiv',
    ];

    await ctx.reply(lines.join('\n'), buildMainKeyboard());
    return;
  }

  const [morningRaw, dayRaw, eveningRaw] = parts;
  const morningParsed = parseSlotInput(morningRaw);
  const dayParsed = parseSlotInput(dayRaw);
  const eveningParsed = parseSlotInput(eveningRaw);

  if (!morningParsed || !dayParsed || !eveningParsed) {
    await ctx.reply(
      'Could not parse input. Use HH:MM or HH:MM-HH:MM formats.',
      buildMainKeyboard()
    );
    return;
  }

  user.slots = buildUpdatedSlotConfigs(user.slots ?? [], {
    MORNING: morningParsed,
    DAY: dayParsed,
    EVENING: eveningParsed,
  });

  await user.save();

  await ctx.reply(
    'Saved. Updated slot settings:\n' +
      `- ${formatSlotSummary(user.slots.find((s) => s.slot === 'MORNING')!)}` +
      `\n- ${formatSlotSummary(user.slots.find((s) => s.slot === 'DAY')!)}` +
      `\n- ${formatSlotSummary(
        user.slots.find((s) => s.slot === 'EVENING')!
      )}\n` +
      `- Timezone: ${user.timezone}\n\n` +
      'Configure morning/day/evening times.\n' +
      'Use HH:MM for fixed or HH:MM-HH:MM for a random window.\n' +
      'Example: /slots 08:30 13:00-15:00 20:15\n' +
      'Quick timezone change: /slots tz Europe/Kyiv',
    buildMainKeyboard()
  );
}
