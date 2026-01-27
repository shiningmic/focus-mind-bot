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

export function formatSessionExportText(
  sessions: SessionDocument[],
  options?: { markdown?: boolean }
): string {
  if (!sessions.length) return 'No answers found.';

  const useMarkdown = options?.markdown ?? false;
  const esc = (text: string) => (useMarkdown ? escapeMarkdownV2(text) : text);

  const lines: string[] = [];
  const grouped = new Map<string, SessionDocument[]>();

  for (const session of sessions) {
    const list = grouped.get(session.dateKey) ?? [];
    list.push(session);
    grouped.set(session.dateKey, list);
  }

  for (const [dateKey, daySessions] of grouped.entries()) {
    lines.push(useMarkdown ? `*${esc(dateKey)}*` : dateKey);

    const ordered = [...daySessions].sort(
      (a, b) => slotOrder[a.slot] - slotOrder[b.slot]
    );

    for (const session of ordered) {
      const label = getSlotLabel(session.slot);
      if (useMarkdown) {
        lines.push(`*${esc(label)}* \\(${esc(session.status)}\\)`);
      } else {
        lines.push(`${label} (${session.status})`);
      }

      if (!session.answers.length) {
        lines.push(useMarkdown ? `_${esc('No answers recorded.')}_` : 'No answers recorded.');
        lines.push('');
        continue;
      }

      session.answers.forEach((answer, index) => {
        const question =
          session.questions.find((q) => q.key === answer.key) ||
          session.questions[index];
        const questionText = question?.text ?? `Question ${index + 1}`;
        const cleanedQuestion =
          stripEmojis(questionText).trim() || questionText;

        if (useMarkdown) {
          lines.push(`• *${esc(cleanedQuestion)}*`, `  → ${esc(answer.text)}`);
        } else {
          lines.push(`- ${cleanedQuestion}`, `  -> ${answer.text}`);
        }
      });

      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
}

export function formatSessionExportByQuestion(
  sessions: SessionDocument[],
  options?: { markdown?: boolean }
): string {
  if (!sessions.length) return 'No answers found.';

  const useMarkdown = options?.markdown ?? false;
  const esc = (text: string) => (useMarkdown ? escapeMarkdownV2(text) : text);

  const grouped = new Map<
    string,
    Array<{ dateKey: string; slot: SlotCode; answer: string }>
  >();
  const questionSlots = new Map<string, Set<SlotCode>>();

  for (const session of sessions) {
    const questionMap = new Map<string, string>();
    session.questions.forEach((q, idx) => {
      const text = q?.text ?? `Question ${idx + 1}`;
      questionMap.set(q.key, text);
    });

    session.answers.forEach((answer, index) => {
      const questionText =
        questionMap.get(answer.key) ?? `Question ${index + 1}`;
      const cleanedQuestion =
        stripEmojis(questionText).trim() || questionText;
      const list = grouped.get(cleanedQuestion) ?? [];
      list.push({
        dateKey: session.dateKey,
        slot: session.slot,
        answer: answer.text,
      });
      grouped.set(cleanedQuestion, list);
      const slotSet = questionSlots.get(cleanedQuestion) ?? new Set<SlotCode>();
      slotSet.add(session.slot);
      questionSlots.set(cleanedQuestion, slotSet);
    });
  }

  const lines: string[] = [];
  const sortedQuestions = [...grouped.keys()].sort((a, b) =>
    a.localeCompare(b)
  );

  for (const questionText of sortedQuestions) {
    const slotSet = questionSlots.get(questionText) ?? new Set<SlotCode>();
    const slotsLabel = [...slotSet]
      .sort((a, b) => slotOrder[a] - slotOrder[b])
      .map((s) => getSlotLabel(s).replace(' reflection', ''))
      .join(', ');
    const header = slotsLabel ? `${questionText} (${slotsLabel})` : questionText;
    lines.push(useMarkdown ? `*${esc(header)}*` : header);

    const entries = grouped.get(questionText) ?? [];
    entries.sort((a, b) => {
      if (a.dateKey === b.dateKey) {
        return slotOrder[a.slot] - slotOrder[b.slot];
      }
      return a.dateKey < b.dateKey ? -1 : 1;
    });

    for (const entry of entries) {
      const prefix = `${entry.dateKey}`;
      if (useMarkdown) {
        lines.push(`• ${esc(prefix)}: ${esc(entry.answer)}`);
      } else {
        lines.push(`- ${prefix}: ${entry.answer}`);
      }
    }

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

const slotOrder: Record<SlotCode, number> = {
  MORNING: 0,
  DAY: 1,
  EVENING: 2,
};

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
