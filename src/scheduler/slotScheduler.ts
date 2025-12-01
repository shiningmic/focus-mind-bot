import cron from 'node-cron';
import type { Telegraf } from 'telegraf';

import type { Types } from 'mongoose';

import { UserModel, type SlotConfig } from '../models/user.model.js';
import { SessionModel } from '../models/session.model.js';
import { getOrCreateSessionForUserSlotDate } from '../services/session.service.js';

let isSchedulerRunning = false;
const slotOrder: Record<'MORNING' | 'DAY' | 'EVENING', number> = {
  MORNING: 0,
  DAY: 1,
  EVENING: 2,
};
const randomWindowTargets = new Map<
  string,
  { dateKey: string; minute: number | null }
>();

// Helper: get user's local time and dateKey in their timezone
function getUserLocalTime(timezone: string): {
  dateKey: string;
  minutesSinceMidnight: number;
} {
  const nowUtc = new Date();

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
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
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);

  return {
    dateKey: `${year}-${month}-${day}`,
    minutesSinceMidnight: hour * 60 + minute,
  };
}

// Decide whether slot should fire now
function isSlotDueNow(
  slot: SlotConfig,
  currentMinutes: number,
  targetRandomMinute?: number | null
): boolean {
  if (slot.mode === 'FIXED') {
    return (
      typeof slot.timeMinutes === 'number' &&
      currentMinutes === slot.timeMinutes
    );
  }

  if (slot.mode === 'RANDOM_WINDOW') {
    return (
      typeof targetRandomMinute === 'number' &&
      currentMinutes === targetRandomMinute
    );
  }

  return false;
}

function getSlotLabel(slot: 'MORNING' | 'DAY' | 'EVENING'): string {
  switch (slot) {
    case 'MORNING':
      return 'Morning reflection';
    case 'DAY':
      return 'Day reflection';
    case 'EVENING':
      return 'Evening reflection';
  }
}

async function expireOldSessionsForUser(
  userId: Types.ObjectId,
  todayKey: string
): Promise<void> {
  await SessionModel.updateMany(
    {
      userId,
      status: { $in: ['pending', 'in_progress'] },
      dateKey: { $lt: todayKey },
    },
    { status: 'expired' }
  ).exec();
}

async function skipEarlierSlotsToday(
  userId: Types.ObjectId,
  dateKey: string,
  currentSlot: 'MORNING' | 'DAY' | 'EVENING'
): Promise<void> {
  const currentOrder = slotOrder[currentSlot];
  const earlierSlots = Object.entries(slotOrder)
    .filter(([, order]) => order < currentOrder)
    .map(([code]) => code);

  if (!earlierSlots.length) return;

  await SessionModel.updateMany(
    {
      userId,
      dateKey,
      slot: { $in: earlierSlots },
      status: { $in: ['pending', 'in_progress'] },
    },
    { status: 'skipped' }
  ).exec();
}

function getRandomWindowMinute(
  userId: Types.ObjectId,
  dateKey: string,
  slot: 'MORNING' | 'DAY' | 'EVENING',
  startMinutes?: number,
  endMinutes?: number
): number | null {
  if (
    typeof startMinutes !== 'number' ||
    typeof endMinutes !== 'number' ||
    startMinutes >= endMinutes
  ) {
    return null;
  }

  const key = `${userId.toString()}-${slot}`;
  const cached = randomWindowTargets.get(key);

  if (cached && cached.dateKey === dateKey && typeof cached.minute === 'number') {
    return cached.minute;
  }

  const minute =
    startMinutes + Math.floor(Math.random() * (endMinutes - startMinutes + 1));

  randomWindowTargets.set(key, { dateKey, minute });
  return minute;
}

/**
 * Start cron scheduler (every minute).
 */
export function startSlotScheduler(bot: Telegraf): void {
  if (isSchedulerRunning) {
    console.log('Slot scheduler is already running');
    return;
  }

  cron.schedule('* * * * *', async () => {
    const tickIso = new Date().toISOString();
    console.log(`⏰ Cron tick at ${tickIso}`);

    try {
      const users = await UserModel.find({})
        .select('telegramId timezone slots')
        .lean()
        .exec();

      if (users.length === 0) {
        console.log('ℹ️ Cron: no users found, skipping.');
        return;
      }

      for (const user of users) {
        const timezone = user.timezone || 'Europe/Kyiv';

        let localTime;
        try {
          localTime = getUserLocalTime(timezone);
        } catch (err) {
          console.error(
            `Failed to compute local time for user ${user._id} (${timezone})`,
            err
          );
          continue;
        }

        const { dateKey, minutesSinceMidnight } = localTime;

        // Expire stale sessions from previous days
        await expireOldSessionsForUser(user._id, dateKey);

        console.log(
          `📅 User ${user._id} | tz=${timezone} | dateKey=${dateKey} | minutes=${minutesSinceMidnight}`
        );

        for (const slotConfig of user.slots) {
          const slot = slotConfig.slot;

          const randomTarget =
            slotConfig.mode === 'RANDOM_WINDOW'
              ? getRandomWindowMinute(
                  user._id,
                  dateKey,
                  slot,
                  slotConfig.windowStartMinutes,
                  slotConfig.windowEndMinutes
                )
              : null;

          if (!isSlotDueNow(slotConfig, minutesSinceMidnight, randomTarget)) {
            continue;
          }

          console.log(
            `  ⏱️ Slot ${slot} is due now for user ${user._id} at minutes=${minutesSinceMidnight}`
          );

          // Check if there is already an in_progress/completed session for this day+slot
          const alreadyExists = await SessionModel.exists({
            userId: user._id,
            slot,
            dateKey,
            status: { $in: ['in_progress', 'completed'] },
          });

          if (alreadyExists) {
            console.log(
              `  ℹ️ Session already in progress/completed for ${slot} on ${dateKey}, skipping`
            );
            continue;
          }

          // Skip earlier pending slots for today to keep only current slot active
          await skipEarlierSlotsToday(user._id, dateKey, slot);

          // Build or load session
          const session = await getOrCreateSessionForUserSlotDate(
            user._id,
            slot,
            dateKey
          );

          console.log(
            `  🗒️ Session ${session._id} created/loaded with ${session.questions.length} questions`
          );

          if (!session.questions.length) {
            console.log('  ⚠️ No questions in session, skipping send');
            continue;
          }

          if (session.status === 'skipped' || session.status === 'expired') {
            console.log(
              `  ⚠️ Session is ${session.status}, not sending question`
            );
            continue;
          }

          const currentIndex = session.currentQuestionIndex ?? 0;
          if (currentIndex >= session.questions.length) {
            console.log('  ℹ️ Session already finished');
            continue;
          }

          const question = session.questions[currentIndex];

          // Mark session as started
          session.status = 'in_progress';
          session.startedAt ||= new Date();
          session.lastInteractionAt = new Date();
          await session.save();

          const label = getSlotLabel(slot);
          const progress =
            session.questions.length > 1
              ? ` (${currentIndex + 1}/${session.questions.length})`
              : '';

          console.log(
            `  📤 Sending first question to telegramId=${user.telegramId}`
          );

          await bot.telegram.sendMessage(
            user.telegramId,
            `🧠 ${label}${progress}

${question.text}`
          );
        }
      }
    } catch (error: any) {
      if (
        error?.name === 'MongoNotConnectedError' ||
        /Client must be connected/.test(error?.message || '')
      ) {
        console.warn(
          '⚠️ MongoNotConnectedError inside scheduler tick - skipping this tick'
        );
        return;
      }

      console.error('❌ Error in slot scheduler cron job:', error);
    }
  });

  isSchedulerRunning = true;
  console.log('🚀 Slot scheduler started (cron: * * * * *)');
}
