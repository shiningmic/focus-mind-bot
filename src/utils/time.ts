import type { SlotCode, SlotMode, QuestionType } from '../types/core.js';

export function parseTimeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return null;

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23) return null;
  if (minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

export function formatMinutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function slotCodeFromString(value: string): SlotCode | null {
  const upper = value.toUpperCase();
  if (upper === 'MORNING') return 'MORNING';
  if (upper === 'DAY') return 'DAY';
  if (upper === 'EVENING') return 'EVENING';
  return null;
}

export function questionTypeFromString(value: string): QuestionType | null {
  const upper = value.toUpperCase();
  if (upper === 'DAILY') return 'DAILY';
  if (upper === 'WEEKLY') return 'WEEKLY';
  if (upper === 'MONTHLY') return 'MONTHLY';
  return null;
}

type ParsedSlotInput =
  | { mode: Extract<SlotMode, 'FIXED'>; timeMinutes: number }
  | {
      mode: Extract<SlotMode, 'RANDOM_WINDOW'>;
      windowStartMinutes: number;
      windowEndMinutes: number;
    };

export function parseSlotInput(raw: string): ParsedSlotInput | null {
  const normalized = raw.replace(/[–—]/g, '-').trim().toLowerCase();

  const rangeMatch = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(normalized);
  if (rangeMatch) {
    const startMinutes = parseTimeToMinutes(rangeMatch[1]);
    const endMinutes = parseTimeToMinutes(rangeMatch[2]);
    if (
      startMinutes === null ||
      endMinutes === null ||
      startMinutes >= endMinutes
    ) {
      return null;
    }
    return {
      mode: 'RANDOM_WINDOW',
      windowStartMinutes: startMinutes,
      windowEndMinutes: endMinutes,
    };
  }

  const fixedMinutes = parseTimeToMinutes(normalized);
  if (fixedMinutes !== null) {
    return { mode: 'FIXED', timeMinutes: fixedMinutes };
  }

  return null;
}

export function getDateKeyForTimezone(timezone: string): string {
  const nowUtc = new Date();

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(nowUtc);
  const get = (type: string) => {
    const part = parts.find((p) => p.type === type);
    if (!part) {
      throw new Error(`Failed to parse "${type}" for timezone ${timezone}`);
    }
    return part.value;
  };

  const year = get('year');
  const month = get('month');
  const day = get('day');

  return `${year}-${month}-${day}`;
}

export function getTimezoneMinutesNow(timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());

  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0';

  const hours = Number.parseInt(hourStr, 10);
  const minutes = Number.parseInt(minuteStr, 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export type { ParsedSlotInput };
