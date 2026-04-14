import type { Context } from 'telegraf';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function buildTelegramProfileBlock(
  from: NonNullable<Context['from']>
): string {
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ');
  const username = from.username ? `@${escapeHtml(from.username)}` : 'not set';
  const language = from.language_code ?? 'not set';
  const premium = from.is_premium ? 'yes' : 'no';

  return [
    '<b>Telegram profile</b>',
    `• <b>ID:</b> <code>${from.id}</code>`,
    `• <b>Name:</b> ${escapeHtml(fullName || from.first_name)}`,
    `• <b>Username:</b> ${username}`,
    `• <b>Language:</b> ${escapeHtml(language)}`,
    `• <b>Premium:</b> ${premium}`,
    `• <b>Profile:</b> <a href="tg://user?id=${from.id}">open in Telegram</a>`,
  ].join('\n');
}
