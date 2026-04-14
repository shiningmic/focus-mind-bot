import type { Context, Telegraf } from 'telegraf';

import { DEFAULT_TIMEZONE } from '../config/constants.js';
import { APP_BASE_URL } from '../config/app.js';
import { buildStartKeyboard } from '../ui/keyboards.js';
import { formatMinutesToTime } from '../utils/time.js';
import { ensureDefaultQuestionBlocksForUser } from '../services/questionBlock.service.js';
import { UserModel, type SlotConfig } from '../models/user.model.js';
import type { SlotCode } from '../types/core.js';
import { escapeHtml } from '../utils/telegramProfile.js';

function buildDefaultSlots(): SlotConfig[] {
  return [
    {
      slot: 'MORNING',
      mode: 'FIXED',
      timeMinutes: 9 * 60,
    },
    {
      slot: 'DAY',
      mode: 'RANDOM_WINDOW',
      windowStartMinutes: 13 * 60,
      windowEndMinutes: 15 * 60,
    },
    {
      slot: 'EVENING',
      mode: 'FIXED',
      timeMinutes: 18 * 60,
    },
  ];
}

function buildStartMessage(
  firstName: string,
  telegramId: number,
  user: { timezone?: string; slots?: SlotConfig[] },
): string {
  const slotMap = new Map<SlotCode, SlotConfig>(
    (user.slots ?? []).map((s) => [s.slot, s]),
  );
  const morning = slotMap.get('MORNING');
  const day = slotMap.get('DAY');
  const evening = slotMap.get('EVENING');

  const morningText =
    morning?.mode === 'FIXED' && typeof morning.timeMinutes === 'number'
      ? formatMinutesToTime(morning.timeMinutes)
      : '09:00';

  const dayText =
    day?.mode === 'RANDOM_WINDOW' &&
    typeof day.windowStartMinutes === 'number' &&
    typeof day.windowEndMinutes === 'number'
      ? `random between ${formatMinutesToTime(
          day.windowStartMinutes,
        )}-${formatMinutesToTime(day.windowEndMinutes)}`
      : 'random between 13:00-15:00';

  const eveningText =
    evening?.mode === 'FIXED' && typeof evening.timeMinutes === 'number'
      ? formatMinutesToTime(evening.timeMinutes)
      : '18:00';

  const tz = user.timezone || DEFAULT_TIMEZONE;

  return (
    `Hello, ${escapeHtml(firstName)}! 👋\n\n` +
    `<b>Focus Mind</b> helps you with daily, weekly, and monthly self-reflection and productivity.\n\n` +
    `<b>Sync ID:</b> <code>${telegramId}</code>\n` +
    `Use this ID to sync your profile and receive notifications at <a href="${APP_BASE_URL}">${APP_BASE_URL.replace(
      /^https?:\/\//,
      ''
    )}</a>.\n\n` +
    `<b>Default schedule:</b>\n` +
    `• Morning: ${morningText}\n` +
    `• Day: ${dayText}\n` +
    `• Evening: ${eveningText}\n` +
    `• Timezone: ${tz}\n\n` +
    `You can always adjust everything later with /settings and /slots.`
  );
}

export function registerStartCommand(bot: Telegraf): void {
  bot.start(async (ctx: Context) => {
    try {
      const from = ctx.from;

      if (!from) {
        await ctx.reply(
          'Unable to read your Telegram profile. Please try again later.',
        );
        return;
      }

      const telegramId = from.id;
      const firstName = from.first_name ?? 'there';

      let user = await UserModel.findOne({ telegramId }).exec();

      if (!user) {
        user = await UserModel.create({
          telegramId,
          timezone: DEFAULT_TIMEZONE,
          slots: buildDefaultSlots(),
        });

        await ensureDefaultQuestionBlocksForUser(user._id);
      }

      await ctx.reply(buildStartMessage(firstName, telegramId, user), {
        ...buildStartKeyboard(),
        parse_mode: 'HTML',
      });
    } catch (error) {
      console.error('Error in /start handler:', error);
      await ctx.reply(
        'Something went wrong while initializing your profile. Please try again later.',
      );
    }
  });
}
