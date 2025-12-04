import type { Markup } from 'telegraf';

type KeyboardMarkup = ReturnType<typeof Markup['keyboard']> | any;

const navStacks = new Map<number, KeyboardMarkup[]>();

function serializeKeyboard(kb: KeyboardMarkup): string {
  const payload = kb?.reply_markup?.keyboard ?? kb?.keyboard ?? kb;
  return JSON.stringify(payload ?? null);
}

export function pushKeyboard(userId: number, keyboard: KeyboardMarkup): void {
  const stack = navStacks.get(userId) ?? [];
  const top = stack[stack.length - 1];
  if (!top || serializeKeyboard(top) !== serializeKeyboard(keyboard)) {
    stack.push(keyboard);
    navStacks.set(userId, stack);
  }
}

export function popKeyboard(userId: number): KeyboardMarkup | null {
  const stack = navStacks.get(userId) ?? [];
  // remove current
  stack.pop();
  const prev = stack.length ? stack[stack.length - 1] : null;
  navStacks.set(userId, stack);
  return prev;
}

export function resetNavigation(userId: number): void {
  navStacks.delete(userId);
}
