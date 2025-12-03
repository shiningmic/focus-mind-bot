import type { SlotCode } from '../types/core.js';
import type { SlotConfig } from '../models/user.model.js';
import type { ParsedSlotInput } from '../utils/time.js';

export function applySingleSlotUpdate(
  currentSlots: SlotConfig[] | undefined,
  slot: SlotCode,
  parsed: ParsedSlotInput
): SlotConfig[] {
  const slots = currentSlots ? [...currentSlots] : [];
  const existingIndex = slots.findIndex((s) => s.slot === slot);

  const base =
    parsed.mode === 'FIXED'
      ? {
          slot,
          mode: 'FIXED' as const,
          timeMinutes: parsed.timeMinutes,
        }
      : {
          slot,
          mode: 'RANDOM_WINDOW' as const,
          windowStartMinutes: parsed.windowStartMinutes,
          windowEndMinutes: parsed.windowEndMinutes,
        };

  if (existingIndex >= 0) {
    slots[existingIndex] = {
      ...slots[existingIndex],
      ...base,
    };
  } else {
    slots.push(base);
  }

  const order: SlotCode[] = ['MORNING', 'DAY', 'EVENING'];
  return slots.sort(
    (a, b) => order.indexOf(a.slot) - order.indexOf(b.slot)
  ) as SlotConfig[];
}

export function buildUpdatedSlotConfigs(
  currentSlots: SlotConfig[],
  updates: Record<SlotCode, ParsedSlotInput>
): SlotConfig[] {
  const defaultSlots: SlotCode[] = ['MORNING', 'DAY', 'EVENING'];

  return defaultSlots.map((slotCode) => {
    const existing = currentSlots.find((s) => s.slot === slotCode);

    const update = updates[slotCode];
    const base: SlotConfig =
      update.mode === 'FIXED'
        ? {
            slot: slotCode,
            mode: 'FIXED',
            timeMinutes: update.timeMinutes,
          }
        : {
            slot: slotCode,
            mode: 'RANDOM_WINDOW',
            windowStartMinutes: update.windowStartMinutes,
            windowEndMinutes: update.windowEndMinutes,
          };

    return {
      ...existing,
      ...base,
    };
  });
}
