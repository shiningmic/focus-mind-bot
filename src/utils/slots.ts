import type { SlotCode } from '../types/core.js';

export function parseSlotsFlag(
  raw: string
): { morning: boolean; day: boolean; evening: boolean } | null {
  const values = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  if (!values.length) return null;

  const flags = { morning: false, day: false, evening: false };
  for (const v of values) {
    if (v === 'morning') flags.morning = true;
    else if (v === 'day') flags.day = true;
    else if (v === 'evening') flags.evening = true;
  }

  if (!flags.morning && !flags.day && !flags.evening) return null;
  return flags;
}

export function getPrimarySlotFromFlags(slots: {
  morning: boolean;
  day: boolean;
  evening: boolean;
}): SlotCode {
  if (slots.morning) return 'MORNING';
  if (slots.day) return 'DAY';
  return 'EVENING';
}
