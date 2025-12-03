import type { SlotCode } from '../types/core.js';
import type { UserDocument } from '../models/user.model.js';
import type { MonthSchedule } from '../types/core.js';

export type PendingAction =
  | { type: 'slot'; slot: SlotCode }
  | { type: 'timezone' }
  | {
      type: 'editDaily';
      step: 'menu' | 'setSlot' | 'setName' | 'setQ1' | 'setQ2' | 'setQ3';
      blockId: string;
      blockName: string;
      slot?: SlotCode;
      q1?: string;
      q2?: string;
      q3?: string;
    }
  | {
      type: 'createDaily';
      step: 'name' | 'slot' | 'q1' | 'q2' | 'q3';
      temp: {
        name?: string;
        slot?: SlotCode;
        q1?: string;
        q2?: string;
        q3?: string;
      };
    }
  | {
      type: 'editWeekly';
      step:
        | 'menu'
        | 'setSlots'
        | 'setDays'
        | 'setName'
        | 'setQ1'
        | 'setQ2'
        | 'setQ3';
      blockId: string;
      blockName: string;
      slots?: { morning: boolean; day: boolean; evening: boolean };
      days?: number[];
      q1?: string;
      q2?: string;
      q3?: string;
    }
  | {
      type: 'createWeekly';
      step: 'name' | 'slots' | 'days' | 'q1' | 'q2' | 'q3';
      temp: {
        name?: string;
        slots?: { morning: boolean; day: boolean; evening: boolean };
        days?: number[];
        q1?: string;
        q2?: string;
        q3?: string;
      };
    }
  | {
      type: 'editMonthly';
      step:
        | 'menu'
        | 'setSlots'
        | 'setSchedule'
        | 'setName'
        | 'setQ1'
        | 'setQ2'
        | 'setQ3';
      blockId: string;
      blockName: string;
      slots?: { morning: boolean; day: boolean; evening: boolean };
      schedule?: MonthSchedule;
      q1?: string;
      q2?: string;
      q3?: string;
    }
  | {
      type: 'createMonthly';
      step: 'name' | 'slots' | 'schedule' | 'q1' | 'q2' | 'q3';
      temp: {
        name?: string;
        slots?: { morning: boolean; day: boolean; evening: boolean };
        schedule?: MonthSchedule;
        q1?: string;
        q2?: string;
        q3?: string;
      };
    };

export const pendingActions = new Map<number, PendingAction>();
