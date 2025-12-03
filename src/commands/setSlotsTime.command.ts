import type { Context, Telegraf } from 'telegraf';

import { formatSlotSummary } from '../utils/format.js';
import { parseSlotInput } from '../utils/time.js';
import { buildUpdatedSlotConfigs } from '../services/slots.service.js';
import { UserModel } from '../models/user.model.js';

export function registerSetSlotsTimeCommand(bot: Telegraf): void {
  bot.command('set_slots_time', async (ctx: Context) => {
    const messageText =
      'text' in (ctx.message ?? {}) ? (ctx.message as any).text ?? '' : '';
    const parts = messageText.trim().split(/\s+/).slice(1); // skip command itself

    if (parts.length < 3) {
      await ctx.reply(
        'Please provide three values for morning/day/evening slots.\n' +
          '- Fixed time: HH:MM (e.g. 08:30)\n' +
          '- Random window: HH:MM-HH:MM (e.g. 13:00-15:00)\n' +
          'Example: /set_slots_time 08:30 13:00-15:00 20:15'
      );
      return;
    }

    const [morningRaw, dayRaw, eveningRaw] = parts;
    const morningParsed = parseSlotInput(morningRaw);
    const dayParsed = parseSlotInput(dayRaw);
    const eveningParsed = parseSlotInput(eveningRaw);

    if (!morningParsed || !dayParsed || !eveningParsed) {
      await ctx.reply(
        'Could not parse input. Use HH:MM or HH:MM-HH:MM formats.'
      );
      return;
    }

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

    user.slots = buildUpdatedSlotConfigs(user.slots ?? [], {
      MORNING: morningParsed,
      DAY: dayParsed,
      EVENING: eveningParsed,
    });

    await user.save();

    await ctx.reply(
      'Done! Updated slot settings:\n' +
        `- ${formatSlotSummary(user.slots.find((s) => s.slot === 'MORNING')!)}` +
        `\n- ${formatSlotSummary(user.slots.find((s) => s.slot === 'DAY')!)}` +
        `\n- ${formatSlotSummary(user.slots.find((s) => s.slot === 'EVENING')!)}`
    );
  });
}
