// Time slots for daily scheduling
export type SlotCode = 'MORNING' | 'DAY' | 'EVENING';

// Source of questions
export type QuestionType = 'DAILY' | 'WEEKLY' | 'MONTHLY';

// How a slot behaves in time
export type SlotMode = 'FIXED' | 'RANDOM_WINDOW';

// Session lifecycle
export type SessionStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped'
  | 'expired';

// Single question in a block
export interface QuestionItem {
  key: string; // internal key, e.g. "mood", "priority"
  text: string; // text shown to user
  order: number; // position inside the block
}

// Monthly scheduling config
export type MonthScheduleKind = 'DAY_OF_MONTH' | 'FIRST_DAY' | 'LAST_DAY';

export interface MonthSchedule {
  kind: MonthScheduleKind;
  dayOfMonth?: number; // only used when kind = "DAY_OF_MONTH"
}
