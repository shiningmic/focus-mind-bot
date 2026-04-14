import type { Context, Telegraf } from 'telegraf';

import { UserModel } from '../models/user.model.js';
import { buildNotificationsKeyboard } from '../ui/keyboards.js';

function getNotificationsArg(ctx: Context): string {
  const text =
    typeof ctx.message === 'object' &&
    ctx.message !== null &&
    'text' in ctx.message
      ? (ctx.message as { text?: string }).text ?? ''
      : '';

  const [, rawArg] = text.trim().split(/\s+/, 2);
  return rawArg?.toLowerCase() ?? '';
}

function buildNotificationsStatusMessage(paused: boolean): string {
  if (paused) {
    return [
      'Notifications are currently paused.',
      'This only stops automatic reminders and scheduled messages.',
      'Use /notifications on to restore them.',
    ].join('\n');
  }

  return [
    'Notifications are currently enabled.',
    'Automatic reminders and scheduled messages are active.',
    'Use /notifications off to pause them.',
  ].join('\n');
}

async function ensureUser(ctx: Context) {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return null;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return null;
  }

  return user;
}

export async function handleNotificationsCommand(
  ctx: Context,
  action?: string
): Promise<void> {
  const user = await ensureUser(ctx);
  if (!user) return;

  const normalizedAction = action?.toLowerCase() ?? getNotificationsArg(ctx);

  if (!normalizedAction || normalizedAction === 'status') {
    await ctx.reply(buildNotificationsStatusMessage(!!user.notificationsPaused), {
      ...buildNotificationsKeyboard(!!user.notificationsPaused),
      skipNavPush: true,
    } as any);
    return;
  }

  if (['off', 'pause', 'disable', 'mute'].includes(normalizedAction)) {
    if (user.notificationsPaused) {
      await ctx.reply(
        'Notifications are already paused. This only affects automatic reminders and scheduled messages. Use /notifications on to restore them.',
        { ...buildNotificationsKeyboard(true), skipNavPush: true } as any
      );
      return;
    }

    user.notificationsPaused = true;
    user.notificationsPausedAt = new Date();
    await user.save();

    await ctx.reply('Notifications paused. Use /notifications on to restore them.', {
      ...buildNotificationsKeyboard(true),
      skipNavPush: true,
    } as any);
    return;
  }

  if (['on', 'resume', 'enable', 'unmute'].includes(normalizedAction)) {
    if (!user.notificationsPaused) {
      await ctx.reply(
        'Notifications are already enabled. Automatic reminders and scheduled messages are active. Use /notifications off to pause them.',
        { ...buildNotificationsKeyboard(false), skipNavPush: true } as any
      );
      return;
    }

    user.notificationsPaused = false;
    user.notificationsPausedAt = null;
    await user.save();

    await ctx.reply('Notifications restored. The bot will send reminders again.', {
      ...buildNotificationsKeyboard(false),
      skipNavPush: true,
    } as any);
    return;
  }

  await ctx.reply(
    'Usage: /notifications [off|on|status]\nThis pauses only automatic reminders and scheduled messages.\nExamples:\n/notifications off\n/notifications on',
    { ...buildNotificationsKeyboard(!!user.notificationsPaused), skipNavPush: true } as any
  );
}

export function registerNotificationsCommand(bot: Telegraf): void {
  bot.command('notifications', async (ctx: Context) => {
    await handleNotificationsCommand(ctx);
  });
}
