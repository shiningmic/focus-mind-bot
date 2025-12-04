import type { SlotCode, MonthSchedule } from '../types/core.js';
import type { SessionDocument } from '../models/session.model.js';

export function formatSlotSummary(slot: {
  slot: SlotCode;
  mode: 'FIXED' | 'RANDOM_WINDOW';
  timeMinutes?: number | null;
  windowStartMinutes?: number | null;
  windowEndMinutes?: number | null;
}): string {
  const labels: Record<SlotCode, string> = {
    MORNING: 'Morning',
    DAY: 'Day',
    EVENING: 'Evening',
  };

  const label = labels[slot.slot] ?? slot.slot;

  if (slot.mode === 'FIXED' && typeof slot.timeMinutes === 'number') {
    return `${label}: fixed at ${formatMinutes(slot.timeMinutes)}`;
  }

  if (
    slot.mode === 'RANDOM_WINDOW' &&
    typeof slot.windowStartMinutes === 'number' &&
    typeof slot.windowEndMinutes === 'number'
  ) {
    return (
      `${label}: random between ` +
      `${formatMinutes(slot.windowStartMinutes)}-` +
      `${formatMinutes(slot.windowEndMinutes)}`
    );
  }

  return `${label}: not configured`;
}

export function formatSlotsForBlock(slots: {
  morning: boolean;
  day: boolean;
  evening: boolean;
}): string {
  const active: string[] = [];
  if (slots.morning) active.push('Morning');
  if (slots.day) active.push('Day');
  if (slots.evening) active.push('Evening');
  return active.length ? active.join(', ') : 'None';
}

export function formatWeekdays(days?: number[]): string {
  if (!days || days.length === 0) return 'not set';
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return days
    .map((d) => (d >= 1 && d <= 7 ? names[d - 1] : String(d)))
    .join(', ');
}

export function formatMonthSchedule(
  schedule: MonthSchedule | undefined
): string {
  if (!schedule) return 'not set';
  if (schedule.kind === 'FIRST_DAY') return 'first day of month';
  if (schedule.kind === 'LAST_DAY') return 'last day of month';
  if (schedule.kind === 'DAY_OF_MONTH' && schedule.dayOfMonth) {
    return `day ${schedule.dayOfMonth}`;
  }
  return 'not set';
}

export function formatSessionExportText(sessions: SessionDocument[]): string {
  if (!sessions.length) return 'No answers found.';

  const lines: string[] = [];

  for (const session of sessions) {
    const label = getSlotLabel(session.slot);
    lines.push(`${session.dateKey} - ${label} (${session.status})`);

    if (!session.answers.length) {
      lines.push('  No answers recorded.');
      lines.push('');
      continue;
    }

    session.answers.forEach((answer, index) => {
      const question =
        session.questions.find((q) => q.key === answer.key) ||
        session.questions[index];
      const questionText = question?.text ?? `Question ${index + 1}`;
      const cleanedQuestion = stripEmojis(questionText).trim() || questionText;

      lines.push(`• ${cleanedQuestion}`);
      lines.push(`→ ${answer.text}`);
    });

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export function buildSessionCompletionSummary(
  session: SessionDocument
): string {
  const label = getSlotLabel(session.slot);
  const lines: string[] = [];

  lines.push(`✅ ${escapeMarkdownV2(label)} completed`);
  lines.push(`📅 Date: *${escapeMarkdownV2(session.dateKey)}*`);
  lines.push('');

  if (session.answers.length === 0) {
    lines.push('_No answers were recorded._');
    return lines.join('\n');
  }

  session.answers.forEach((answer, index) => {
    const question =
      session.questions.find((q) => q.key === answer.key) ||
      session.questions[index];

    const questionText = question?.text ?? `Question ${index + 1}`;
    const cleanedQuestion = stripEmojis(questionText).trim() || questionText;

    lines.push(
      `*${escapeMarkdownV2(cleanedQuestion)}*`,
      `${escapeMarkdownV2(answer.text)}`,
      '' // empty line between blocks
    );
  });

  return lines.join('\n');
}

export function getSlotLabel(slot: SlotCode): string {
  switch (slot) {
    case 'MORNING':
      return 'Morning reflection';
    case 'DAY':
      return 'Day reflection';
    case 'EVENING':
      return 'Evening reflection';
  }
}

export function buildQuestionPrompt(
  slot: SlotCode,
  questionText: string,
  index: number,
  total: number
): string {
  // Keep the prompt minimal: just the question text (no slot header or progress)
  return questionText;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

function stripEmojis(text: string): string {
  // Remove most emoji pictographs and presentation characters
  return text.replace(
    /[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu,
    ''
  );
}
