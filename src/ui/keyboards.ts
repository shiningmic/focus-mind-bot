import { Markup } from 'telegraf';
import type { SlotCode } from '../types/core.js';

export const QUICK_ACTION_LABELS = {
  morning: '🌅 Morning ⌛',
  day: '🕑 Day 💼',
  evening: '🌙 Evening ✨',
  timezone: '🌍 Timezone ⏱️',
} as const;

export const HELP_BUTTON_LABEL = '❓ Help';
export const SETTINGS_BUTTON_LABEL = '⚙️ Settings';
export const BACK_BUTTON_LABEL = '⬅️ Back';

export const SETTINGS_BUTTON_LABELS = {
  slots: '🕒 Slots',
  daily: '📘 Daily',
  weekly: '📅 Weekly',
  monthly: '🗓️ Monthly',
} as const;

export const ADD_DAILY_BUTTON = '➕ Add daily set';
export const ADD_WEEKLY_BUTTON = '➕ Add weekly set';
export const ADD_MONTHLY_BUTTON = '➕ Add monthly set';

export const DAILY_EDIT_ACTION_BUTTONS = {
  slot: '🕐 Change slot',
  name: '✏️ Rename set',
  q1: '❔ Edit question 1',
  q2: '❔ Edit question 2',
  q3: '❔ Edit question 3',
  delete: '🗑️ Delete set',
  back: BACK_BUTTON_LABEL,
} as const;

export const WEEKLY_EDIT_ACTION_BUTTONS = {
  slots: '🕒 Change slots',
  days: '📅 Change days',
  name: '✏️ Rename set',
  q1: '❔ Edit question 1',
  q2: '❔ Edit question 2',
  q3: '❔ Edit question 3',
  delete: '🗑️ Delete set',
  back: BACK_BUTTON_LABEL,
} as const;

export const MONTHLY_EDIT_ACTION_BUTTONS = {
  slots: '🕐 Change slots',
  schedule: '🗓️ Change schedule',
  name: '✏️ Rename set',
  q1: '❔ Edit question 1',
  q2: '❔ Edit question 2',
  q3: '❔ Edit question 3',
  delete: '🗑️ Delete set',
  back: BACK_BUTTON_LABEL,
} as const;

export const REMINDER_BUTTON_LABELS = {
  startPrefix: '💬 Start',
  skipPrefix: '⏭️ Skip previous and start',
} as const;

export const CLEAR_QUESTION_BUTTON_LABEL = '? Skip question';

function slotTitle(slot: SlotCode): string {
  switch (slot) {
    case 'MORNING':
      return 'Morning';
    case 'DAY':
      return 'Day';
    case 'EVENING':
      return 'Evening';
  }
}

export function buildPendingReminderKeyboard(slot: SlotCode) {
  const title = slotTitle(slot);
  const skipLabel = `${REMINDER_BUTTON_LABELS.skipPrefix} ${title}`;

  return Markup.keyboard([[skipLabel], [BACK_BUTTON_LABEL]]).resize();
}

export function buildStartKeyboard() {
  return Markup.keyboard([
    [SETTINGS_BUTTON_LABELS.slots, SETTINGS_BUTTON_LABELS.daily],
    [SETTINGS_BUTTON_LABELS.weekly, SETTINGS_BUTTON_LABELS.monthly],
    [SETTINGS_BUTTON_LABEL, HELP_BUTTON_LABEL],
  ]).resize();
}

export function buildBackKeyboard() {
  return Markup.keyboard([[BACK_BUTTON_LABEL]]).resize();
}

export function buildSlotKeyboard() {
  return Markup.keyboard([
    [QUICK_ACTION_LABELS.morning, QUICK_ACTION_LABELS.day],
    [QUICK_ACTION_LABELS.evening, QUICK_ACTION_LABELS.timezone],
    [BACK_BUTTON_LABEL],
  ]).resize();
}

export function buildSettingKeyboard() {
  return Markup.keyboard([[SETTINGS_BUTTON_LABEL, BACK_BUTTON_LABEL]]).resize();
}

export function buildSettingsKeyboard() {
  return Markup.keyboard([
    [SETTINGS_BUTTON_LABELS.slots, SETTINGS_BUTTON_LABELS.daily],
    [SETTINGS_BUTTON_LABELS.weekly, SETTINGS_BUTTON_LABELS.monthly],
  ]).resize();
}

function chunkButtons(labels: string[], perRow: number): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < labels.length; i += perRow) {
    rows.push(labels.slice(i, i + perRow));
  }
  return rows;
}

export function buildDailyKeyboard(
  blocks?: Array<{ name: string }>
): ReturnType<typeof Markup.keyboard> {
  if (!blocks || blocks.length === 0) {
    return Markup.keyboard([[ADD_DAILY_BUTTON], [BACK_BUTTON_LABEL]]).resize();
  }
  const labels = blocks.map((b) => `✏️ ${b.name}`);
  const rows = chunkButtons(labels, 2);
  if (blocks.length < 3) rows.push([ADD_DAILY_BUTTON]);
  rows.push([BACK_BUTTON_LABEL]);
  return Markup.keyboard(rows).resize();
}

export function buildDailyEditKeyboard(includeClear = false) {
  const rows = [
    [DAILY_EDIT_ACTION_BUTTONS.slot, DAILY_EDIT_ACTION_BUTTONS.name],
    [DAILY_EDIT_ACTION_BUTTONS.q1, DAILY_EDIT_ACTION_BUTTONS.q2],
    [DAILY_EDIT_ACTION_BUTTONS.q3, DAILY_EDIT_ACTION_BUTTONS.delete],
  ] as string[][];
  if (includeClear) rows.push([CLEAR_QUESTION_BUTTON_LABEL]);
  rows.push([BACK_BUTTON_LABEL]);
  return Markup.keyboard(rows).resize();
}

export function buildDailyCreateKeyboard() {
  return Markup.keyboard([
    [DAILY_EDIT_ACTION_BUTTONS.delete],
    [BACK_BUTTON_LABEL],
  ]).resize();
}

export function buildWeeklyKeyboard(
  blocks?: Array<{ name: string }>
): ReturnType<typeof Markup.keyboard> {
  if (!blocks || blocks.length === 0) {
    return Markup.keyboard([[ADD_WEEKLY_BUTTON], [BACK_BUTTON_LABEL]]).resize();
  }
  const labels = blocks.map((b) => `✏️ ${b.name}`);
  const rows = chunkButtons(labels, 2);
  if (blocks.length < 3) rows.push([ADD_WEEKLY_BUTTON]);
  rows.push([BACK_BUTTON_LABEL]);
  return Markup.keyboard(rows).resize();
}

export function buildWeeklyEditKeyboard(includeClear = false) {
  const rows = [
    [WEEKLY_EDIT_ACTION_BUTTONS.slots, WEEKLY_EDIT_ACTION_BUTTONS.days],
    [WEEKLY_EDIT_ACTION_BUTTONS.name, WEEKLY_EDIT_ACTION_BUTTONS.q1],
    [WEEKLY_EDIT_ACTION_BUTTONS.q2, WEEKLY_EDIT_ACTION_BUTTONS.q3],
    [WEEKLY_EDIT_ACTION_BUTTONS.delete],
  ] as string[][];
  if (includeClear) rows.push([CLEAR_QUESTION_BUTTON_LABEL]);
  rows.push([BACK_BUTTON_LABEL]);
  return Markup.keyboard(rows).resize();
}

export function buildWeeklyCreateKeyboard() {
  return Markup.keyboard([
    [WEEKLY_EDIT_ACTION_BUTTONS.delete],
    [BACK_BUTTON_LABEL],
  ]).resize();
}

export function buildMonthlyKeyboard(
  blocks?: Array<{ name: string }>
): ReturnType<typeof Markup.keyboard> {
  if (!blocks || blocks.length === 0) {
    return Markup.keyboard([
      [ADD_MONTHLY_BUTTON],
      [BACK_BUTTON_LABEL],
    ]).resize();
  }
  const labels = blocks.map((b) => `✏️ ${b.name}`);
  const rows = chunkButtons(labels, 2);
  if (blocks.length < 3) rows.push([ADD_MONTHLY_BUTTON]);
  rows.push([BACK_BUTTON_LABEL]);
  return Markup.keyboard(rows).resize();
}

export function buildMonthlyEditKeyboard(includeClear = false) {
  const rows = [
    [MONTHLY_EDIT_ACTION_BUTTONS.slots, MONTHLY_EDIT_ACTION_BUTTONS.schedule],
    [MONTHLY_EDIT_ACTION_BUTTONS.name, MONTHLY_EDIT_ACTION_BUTTONS.q1],
    [MONTHLY_EDIT_ACTION_BUTTONS.q2, MONTHLY_EDIT_ACTION_BUTTONS.q3],
    [MONTHLY_EDIT_ACTION_BUTTONS.delete],
  ] as string[][];
  if (includeClear) rows.push([CLEAR_QUESTION_BUTTON_LABEL]);
  rows.push([BACK_BUTTON_LABEL]);
  return Markup.keyboard(rows).resize();
}

export function buildMonthlyCreateKeyboard() {
  return Markup.keyboard([
    [MONTHLY_EDIT_ACTION_BUTTONS.delete],
    [BACK_BUTTON_LABEL],
  ]).resize();
}

