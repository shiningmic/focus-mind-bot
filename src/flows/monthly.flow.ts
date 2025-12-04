import type { Context } from 'telegraf';
import mongoose from 'mongoose';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { UserModel } from '../models/user.model.js';
import { pendingActions } from '../state/pending.js';
import {
  MONTHLY_EDIT_ACTION_BUTTONS,
  buildMonthlyEditKeyboard,
  buildMonthlyKeyboard,
} from '../ui/keyboards.js';
import { parseSlotsFlag } from '../utils/slots.js';
import type { MonthSchedule } from '../types/core.js';

function parseMonthScheduleInput(raw: string): MonthSchedule | null {
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'first') return { kind: 'FIRST_DAY' };
  if (trimmed === 'last') return { kind: 'LAST_DAY' };
  if (trimmed.startsWith('day:')) {
    const num = Number.parseInt(trimmed.slice(4), 10);
    if (!Number.isInteger(num) || num < 1 || num > 28) return null;
    return { kind: 'DAY_OF_MONTH', dayOfMonth: num };
  }
  return null;
}

export async function startMonthlyEditFlow(
  ctx: Context,
  blockName: string
): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const order: Array<'morning' | 'day' | 'evening'> = [
    'morning',
    'day',
    'evening',
  ];
  const monthlyBlocks = await QuestionBlockModel.find({
    userId: user._id,
    type: 'MONTHLY',
  })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  const sorted = [...monthlyBlocks].sort((a, b) => {
    const aIdxRaw = order.findIndex((s) => (a.slots as any)[s]);
    const bIdxRaw = order.findIndex((s) => (b.slots as any)[s]);
    const aIdx = aIdxRaw === -1 ? order.length : aIdxRaw;
    const bIdx = bIdxRaw === -1 ? order.length : bIdxRaw;
    return aIdx - bIdx;
  });

  const targetName = blockName.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
  const block = sorted.find(
    (b) => b.name.trim().toLowerCase() === targetName
  );

  if (!block) {
    await ctx.reply('This monthly set does not exist. Try another.');
    return;
  }

  pendingActions.set(from.id, {
    type: 'editMonthly',
    step: 'menu',
    blockId: block._id.toString(),
    blockName: block.name,
  });

  await ctx.reply(
    `Editing monthly set "${block.name}".\nUse buttons to change slots, schedule, name, or questions.`,
    buildMonthlyEditKeyboard()
  );
}

export async function startMonthlyCreateFlow(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) {
    await ctx.reply('Unable to read your Telegram profile. Please try again.');
    return;
  }

  const user = await UserModel.findOne({ telegramId: from.id }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const count = await QuestionBlockModel.countDocuments({
    userId: user._id,
    type: 'MONTHLY',
  }).exec();

  if (count >= 3) {
    await ctx.reply(
      'You already have 3 monthly sets. Delete one to add another.',
      buildMonthlyKeyboard()
    );
    return;
  }

  pendingActions.set(from.id, {
    type: 'createMonthly',
    step: 'name',
    temp: {},
  });

  await ctx.reply('Enter a name for the new monthly set:', buildMonthlyEditKeyboard());
}

export async function handleEditMonthlyFlow(
  ctx: Context,
  userId: mongoose.Types.ObjectId,
  messageText: string,
  pendingAction: Extract<
    import('../state/pending.js').PendingAction,
    { type: 'editMonthly' }
  >
): Promise<void> {
  const block = await QuestionBlockModel.findOne({
    _id: pendingAction.blockId,
    userId,
    type: 'MONTHLY',
  }).exec();

  if (!block) {
    pendingActions.delete(ctx.from!.id);
    await ctx.reply('This monthly set no longer exists.', buildMonthlyKeyboard());
    return;
  }

  const input = messageText.trim().toLowerCase();

  if (pendingAction.step === 'menu') {
    if (input === 'back' || input === MONTHLY_EDIT_ACTION_BUTTONS.back.toLowerCase()) {
      pendingActions.delete(ctx.from!.id);
      const blocks = await QuestionBlockModel.find({ userId, type: 'MONTHLY' })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
      await ctx.reply('Back.', buildMonthlyKeyboard(blocks));
      return;
    }
    if (input === 'delete' || input === MONTHLY_EDIT_ACTION_BUTTONS.delete.toLowerCase()) {
      await QuestionBlockModel.deleteOne({ _id: block._id }).exec();
      pendingActions.delete(ctx.from!.id);
      await ctx.reply('Deleted monthly set.', buildMonthlyKeyboard());
      return;
    }
    if (input === 'slots' || input === MONTHLY_EDIT_ACTION_BUTTONS.slots.toLowerCase()) {
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'setSlots' });
      await ctx.reply('Send slots: morning, day, evening (comma-separated)', buildMonthlyEditKeyboard());
      return;
    }
    if (input === 'schedule' || input === MONTHLY_EDIT_ACTION_BUTTONS.schedule.toLowerCase()) {
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'setSchedule' });
      await ctx.reply('Send schedule: first | last | day:10', buildMonthlyEditKeyboard());
      return;
    }
    if (input === 'name' || input === MONTHLY_EDIT_ACTION_BUTTONS.name.toLowerCase()) {
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'setName' });
      await ctx.reply('Send new name:', buildMonthlyEditKeyboard());
      return;
    }
    if (['q1', 'q2', 'q3'].includes(input) ||
        input === MONTHLY_EDIT_ACTION_BUTTONS.q1.toLowerCase() ||
        input === MONTHLY_EDIT_ACTION_BUTTONS.q2.toLowerCase() ||
        input === MONTHLY_EDIT_ACTION_BUTTONS.q3.toLowerCase()) {
      const stepMap: Record<string, 'setQ1' | 'setQ2' | 'setQ3'> = {
        'q1': 'setQ1',
        'q2': 'setQ2',
        'q3': 'setQ3',
        [MONTHLY_EDIT_ACTION_BUTTONS.q1.toLowerCase()]: 'setQ1',
        [MONTHLY_EDIT_ACTION_BUTTONS.q2.toLowerCase()]: 'setQ2',
        [MONTHLY_EDIT_ACTION_BUTTONS.q3.toLowerCase()]: 'setQ3',
      };
      pendingActions.set(ctx.from!.id, {
        ...pendingAction,
        step: stepMap[input] || 'setQ1',
      });
      await ctx.reply('Send new question text:', buildMonthlyEditKeyboard());
      return;
    }
    await ctx.reply(
      'Unknown action. Use buttons or send: slots | schedule | name | q1 | q2 | q3 | delete | back',
      buildMonthlyEditKeyboard()
    );
    return;
  }

  if (pendingAction.step === 'setSlots') {
    const slots = parseSlotsFlag(messageText);
    if (!slots) {
      await ctx.reply(
        'Invalid slots. Use morning, day, evening separated by commas.',
      buildMonthlyEditKeyboard()
      );
      return;
    }
    block.slots = slots;
    await block.save();
    pendingActions.delete(ctx.from!.id);
    
    // Show updated block list
    const blocks = await QuestionBlockModel.find({ userId, type: 'MONTHLY' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    await ctx.reply('Slots updated.', buildMonthlyKeyboard(blocks));
    return;
  }

  if (pendingAction.step === 'setSchedule') {
    const parsed = parseMonthScheduleInput(messageText);
    if (!parsed) {
      await ctx.reply(
        'Schedule must be: first | last | day:N (1-28).',
        buildMonthlyEditKeyboard()
      );
      return;
    }
    block.monthSchedule = parsed;
    await block.save();
    pendingActions.delete(ctx.from!.id);
    
    // Show updated block list
    const blocks = await QuestionBlockModel.find({ userId, type: 'MONTHLY' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    await ctx.reply('Schedule updated.', buildMonthlyKeyboard(blocks));
    return;
  }

  if (pendingAction.step === 'setName') {
    const name = messageText.trim();
    if (!name) {
      await ctx.reply('Name cannot be empty.', buildMonthlyEditKeyboard());
      return;
    }
    block.name = name;
    await block.save();
    pendingActions.delete(ctx.from!.id);
    
    // Show updated block list
    const blocks = await QuestionBlockModel.find({ userId, type: 'MONTHLY' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    await ctx.reply('Name updated.', buildMonthlyKeyboard(blocks));
    return;
  }

  const updateQuestion = async (index: number) => {
    const text = messageText.trim();
    if (!text) {
      await ctx.reply('Question text cannot be empty.', buildMonthlyEditKeyboard());
      return;
    }
    const questions = [...block.questions];
    const existing = questions.find((q) => q.order === index);
    if (existing) {
      existing.text = text;
    } else {
      questions.push({ key: `q${index + 1}`, text, order: index } as any);
    }
    block.questions = questions.sort((a, b) => a.order - b.order);
    await block.save();
    pendingActions.delete(ctx.from!.id);
    
    // Show updated block list
    const blocks = await QuestionBlockModel.find({ userId, type: 'MONTHLY' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    await ctx.reply('Question updated.', buildMonthlyKeyboard(blocks));
  };

  if (pendingAction.step === 'setQ1') return updateQuestion(0);
  if (pendingAction.step === 'setQ2') return updateQuestion(1);
  if (pendingAction.step === 'setQ3') return updateQuestion(2);
}

export async function handleCreateMonthlyFlow(
  ctx: Context,
  userId: mongoose.Types.ObjectId,
  messageText: string,
  pendingAction: Extract<
    import('../state/pending.js').PendingAction,
    { type: 'createMonthly' }
  >
): Promise<void> {
  const maxBlocks = 3;
  let state = { ...(pendingAction.temp || {}) };
  const step = pendingAction.step;

  if (step === 'name') {
    const existingCount = await QuestionBlockModel.countDocuments({
      userId,
      type: 'MONTHLY',
    }).exec();
    if (existingCount >= maxBlocks) {
      pendingActions.delete(ctx.from!.id);
      await ctx.reply(
        'You already have 3 monthly sets. Delete one to add another.',
        buildMonthlyKeyboard()
      );
      return;
    }

    const name = messageText.trim();
    if (!name) {
      await ctx.reply('Name cannot be empty.', buildMonthlyEditKeyboard());
      return;
    }
    pendingActions.set(ctx.from!.id, {
      ...pendingAction,
      step: 'slots',
      temp: { ...state, name },
    });
    await ctx.reply('Send slots: morning, day, evening (comma-separated). At least one required.', buildMonthlyEditKeyboard());
    return;
  }

  if (step === 'slots') {
    const slots = parseSlotsFlag(messageText);
    if (!slots) {
      await ctx.reply('Invalid slots. Use morning, day, evening separated by commas.', buildMonthlyEditKeyboard());
      return;
    }
    pendingActions.set(ctx.from!.id, {
      ...pendingAction,
      step: 'schedule',
      temp: { ...state, slots },
    });
    await ctx.reply('Send schedule: first | last | day:10', buildMonthlyEditKeyboard());
    return;
  }

  if (step === 'schedule') {
    const schedule = parseMonthScheduleInput(messageText);
    if (!schedule) {
      await ctx.reply('Schedule must be: first | last | day:N (1-28).', buildMonthlyEditKeyboard());
      return;
    }
    pendingActions.set(ctx.from!.id, {
      ...pendingAction,
      step: 'q1',
      temp: { ...state, schedule },
    });
    await ctx.reply('Question 1:', buildMonthlyEditKeyboard());
    return;
  }

  const pushQuestion = (key: 'q1' | 'q2' | 'q3', nextStep: string | null) => {
    const text = messageText.trim();
    if (!text) {
      void ctx.reply('Question text cannot be empty.', buildMonthlyEditKeyboard());
      return null;
    }
    const nextTemp = { ...state, [key]: text };
    if (nextStep) {
      pendingActions.set(ctx.from!.id, {
        ...pendingAction,
        step: nextStep as any,
        temp: nextTemp,
      });
      const label =
        nextStep === 'q2'
          ? 'Question 2 (or type "skip" to finish with one question):'
          : 'Question 3 (or type "skip" to finish):';
      void ctx.reply(label, buildMonthlyEditKeyboard());
      return true;
    }
    return nextTemp;
  };

  if (step === 'q1') {
    const res = pushQuestion('q1', 'q2');
    if (res === true || res === undefined || res === null) return;
    state = res;
    return;
  }

  if (step === 'q2') {
    if (messageText.trim().toLowerCase() === 'skip') {
      // keep current
    } else {
      const res = pushQuestion('q2', 'q3');
      if (res === true || res === undefined || res === null) return;
      state = res;
      return;
    }
  }

  if (step === 'q3') {
    if (messageText.trim().toLowerCase() !== 'skip') {
      const text = messageText.trim();
      if (!text) {
        await ctx.reply('Question text cannot be empty.', buildMonthlyEditKeyboard());
        return;
      }
      state = { ...state, q3: text };
    }
  }

  const questions = [state.q1, state.q2, state.q3].filter(Boolean) as string[];
  if (!state.name || !state.slots || !state.schedule) {
    await ctx.reply('Something went wrong. Please start creation again with the Add button.', buildMonthlyKeyboard());
    pendingActions.delete(ctx.from!.id);
    return;
  }
  if (!questions.length) {
    await ctx.reply('At least one question is required.', buildMonthlyEditKeyboard());
    return;
  }

  await QuestionBlockModel.create({
    userId,
    type: 'MONTHLY',
    name: state.name,
    slots: state.slots,
    monthSchedule: state.schedule,
    questions: questions.map((text, idx) => ({
      key: `q${idx + 1}`,
      text,
      order: idx,
    })),
  });

  pendingActions.delete(ctx.from!.id);
  await ctx.reply(`Monthly set "${state.name}" created.`, buildMonthlyKeyboard());
}

