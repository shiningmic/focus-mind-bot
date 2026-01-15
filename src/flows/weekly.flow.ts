import type { Context } from 'telegraf';
import mongoose from 'mongoose';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { UserModel } from '../models/user.model.js';
import { pendingActions } from '../state/pending.js';
import {
  WEEKLY_EDIT_ACTION_BUTTONS,
  CLEAR_QUESTION_BUTTON_LABEL,
  buildWeeklyEditKeyboard,
  buildWeeklyCreateKeyboard,
  buildWeeklyKeyboard,
} from '../ui/keyboards.js';
import { resetNavigation } from '../state/navigation.js';
import { parseSlotsFlag } from '../utils/slots.js';

function sortWeeklyBlocks(blocks: Array<{ slots: any; name: string }>) {
  const order: Array<'morning' | 'day' | 'evening'> = [
    'morning',
    'day',
    'evening',
  ];
  return [...blocks].sort((a, b) => {
    const aIdxRaw = order.findIndex((s) => a.slots?.[s]);
    const bIdxRaw = order.findIndex((s) => b.slots?.[s]);
    const aIdx = aIdxRaw === -1 ? order.length : aIdxRaw;
    const bIdx = bIdxRaw === -1 ? order.length : bIdxRaw;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.name.localeCompare(b.name);
  });
}

export async function startWeeklyEditFlow(
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
  const weeklyBlocks = await QuestionBlockModel.find({
    userId: user._id,
    type: 'WEEKLY',
  })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  const sorted = [...weeklyBlocks].sort((a, b) => {
    const aIdxRaw = order.findIndex((s) => (a.slots as any)[s]);
    const bIdxRaw = order.findIndex((s) => (b.slots as any)[s]);
    const aIdx = aIdxRaw === -1 ? order.length : aIdxRaw;
    const bIdx = bIdxRaw === -1 ? order.length : bIdxRaw;
    return aIdx - bIdx;
  });

  const targetName = blockName.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();
  const block = sorted.find(
    (b) =>
      b.name
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .trim()
        .toLowerCase() === targetName
  );

  if (!block) {
    await ctx.reply('This weekly set does not exist. Try another.');
    return;
  }

  pendingActions.set(from.id, {
    type: 'editWeekly',
    step: 'menu',
    blockId: block._id.toString(),
    blockName: block.name,
  });

  await ctx.reply(
    `Editing weekly set "${block.name}".\nUse buttons to change slots, days, name, or questions.`,
    buildWeeklyEditKeyboard()
  );
}

export async function startWeeklyCreateFlow(ctx: Context): Promise<void> {
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
    type: 'WEEKLY',
  }).exec();

  if (count >= 3) {
    await ctx.reply(
      'You already have 3 weekly sets. Delete one to add another.',
      buildWeeklyKeyboard()
    );
    return;
  }

  pendingActions.set(from.id, {
    type: 'createWeekly',
    step: 'name',
    temp: {},
  });

  await ctx.reply(
    'Enter a name for the new weekly set:',
    buildWeeklyCreateKeyboard()
  );
}

export async function handleEditWeeklyFlow(
  ctx: Context,
  userId: mongoose.Types.ObjectId,
  messageText: string,
  pendingAction: Extract<
    import('../state/pending.js').PendingAction,
    { type: 'editWeekly' }
  >
): Promise<void> {
  const block = await QuestionBlockModel.findOne({
    _id: pendingAction.blockId,
    userId,
    type: 'WEEKLY',
  }).exec();

  if (!block) {
    pendingActions.delete(ctx.from!.id);
    await ctx.reply('This weekly set no longer exists.', buildWeeklyKeyboard());
    return;
  }

  const input = messageText.trim().toLowerCase();

  if (pendingAction.step === 'menu') {
    if (input === 'back' || input === WEEKLY_EDIT_ACTION_BUTTONS.back.toLowerCase()) {
      pendingActions.delete(ctx.from!.id);
      const blocks = await QuestionBlockModel.find({ userId, type: 'WEEKLY' })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
      await ctx.reply('Back.', buildWeeklyKeyboard(sortWeeklyBlocks(blocks)));
      return;
    }
    if (input === 'delete' || input === WEEKLY_EDIT_ACTION_BUTTONS.delete.toLowerCase()) {
      await QuestionBlockModel.deleteOne({ _id: block._id }).exec();
      pendingActions.delete(ctx.from!.id);
      resetNavigation(ctx.from!.id);
      const blocks = await QuestionBlockModel.find({ userId, type: 'WEEKLY' })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
      await ctx.reply(
        'Deleted weekly set.',
        buildWeeklyKeyboard(sortWeeklyBlocks(blocks))
      );
      return;
    }
    if (input === 'slots' || input === WEEKLY_EDIT_ACTION_BUTTONS.slots.toLowerCase()) {
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'setSlots' });
      await ctx.reply('Send slots: morning, day, evening (comma-separated)', buildWeeklyEditKeyboard());
      return;
    }
    if (input === 'days' || input === WEEKLY_EDIT_ACTION_BUTTONS.days.toLowerCase()) {
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'setDays' });
      await ctx.reply('Send days of week as numbers 1-7, comma-separated.', buildWeeklyEditKeyboard());
      return;
    }
    if (input === 'name' || input === WEEKLY_EDIT_ACTION_BUTTONS.name.toLowerCase()) {
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'setName' });
      await ctx.reply('Send new name:', buildWeeklyEditKeyboard());
      return;
    }
    if (['q1', 'q2', 'q3'].includes(input) ||
        input === WEEKLY_EDIT_ACTION_BUTTONS.q1.toLowerCase() ||
        input === WEEKLY_EDIT_ACTION_BUTTONS.q2.toLowerCase() ||
        input === WEEKLY_EDIT_ACTION_BUTTONS.q3.toLowerCase()) {
      const stepMap: Record<string, 'setQ1' | 'setQ2' | 'setQ3'> = {
        'q1': 'setQ1',
        'q2': 'setQ2',
        'q3': 'setQ3',
        [WEEKLY_EDIT_ACTION_BUTTONS.q1.toLowerCase()]: 'setQ1',
        [WEEKLY_EDIT_ACTION_BUTTONS.q2.toLowerCase()]: 'setQ2',
        [WEEKLY_EDIT_ACTION_BUTTONS.q3.toLowerCase()]: 'setQ3',
      };
      pendingActions.set(ctx.from!.id, {
        ...pendingAction,
        step: stepMap[input] || 'setQ1',
      });
      await ctx.reply(
        'Send new question text, or type "skip" to clear this question.',
        buildWeeklyEditKeyboard(true)
      );
      return;
    }
    await ctx.reply(
      'Unknown action. Use buttons or send: slots | days | name | q1 | q2 | q3 | delete | back',
      buildWeeklyEditKeyboard()
    );
    return;
  }

  if (pendingAction.step === 'setSlots') {
    const slots = parseSlotsFlag(messageText);
    if (!slots) {
      await ctx.reply(
        'Invalid slots. Use morning, day, evening separated by commas.',
      buildWeeklyEditKeyboard()
      );
      return;
    }
    block.slots = slots;
    await block.save();
    pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'menu' });
    await ctx.reply('Slots updated. Choose next action:', buildWeeklyEditKeyboard());
    return;
  }

  if (pendingAction.step === 'setDays') {
    const parsed = messageText
      .split(',')
      .map((d) => Number.parseInt(d.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
    if (!parsed.length) {
      await ctx.reply('Provide days 1-7 separated by commas.',
      buildWeeklyEditKeyboard());
      return;
    }
    block.daysOfWeek = parsed;
    await block.save();
    pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'menu' });
    await ctx.reply('Days updated. Choose next action:', buildWeeklyEditKeyboard());
    return;
  }

  if (pendingAction.step === 'setName') {
    const name = messageText.trim();
    if (!name) {
      await ctx.reply('Name cannot be empty.', buildWeeklyEditKeyboard());
      return;
    }
    block.name = name;
    await block.save();
    pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'menu' });
    await ctx.reply('Name updated. Choose next action:', buildWeeklyEditKeyboard());
    return;
  }

  const updateQuestion = async (index: number) => {
    const text = messageText.trim();
    const normalized = text.toLowerCase();
    const questions = [...block.questions];

    if (
      normalized === 'skip' ||
      normalized === 'clear' ||
      messageText === CLEAR_QUESTION_BUTTON_LABEL
    ) {
      block.questions = questions
        .filter((q) => q.order !== index)
        .sort((a, b) => a.order - b.order);
      await block.save();
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'menu' });
      await ctx.reply(
        'Question cleared. Choose next action:',
        buildWeeklyEditKeyboard()
      );
      return;
    }

    if (!text) {
      await ctx.reply(
        'Question text cannot be empty.',
        buildWeeklyEditKeyboard(true)
      );
      return;
    }

    const existing = questions.find((q) => q.order === index);
    if (existing) {
      existing.text = text;
    } else {
      questions.push({ key: `q${index + 1}`, text, order: index } as any);
    }
    block.questions = questions.sort((a, b) => a.order - b.order);
    await block.save();
    pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'menu' });
    await ctx.reply(
      'Question updated. Choose next action:',
      buildWeeklyEditKeyboard()
    );
  };

  if (pendingAction.step === 'setQ1') return updateQuestion(0);
  if (pendingAction.step === 'setQ2') return updateQuestion(1);
  if (pendingAction.step === 'setQ3') return updateQuestion(2);
}

export async function handleCreateWeeklyFlow(
  ctx: Context,
  userId: mongoose.Types.ObjectId,
  messageText: string,
  pendingAction: Extract<
    import('../state/pending.js').PendingAction,
    { type: 'createWeekly' }
  >
): Promise<void> {
  const maxBlocks = 3;
  let state = { ...(pendingAction.temp || {}) };
  const step = pendingAction.step;
  const input = messageText.trim().toLowerCase();

  if (
    input === 'delete' ||
    input === WEEKLY_EDIT_ACTION_BUTTONS.delete.toLowerCase()
  ) {
    pendingActions.delete(ctx.from!.id);
    resetNavigation(ctx.from!.id);
    const blocks = await QuestionBlockModel.find({ userId, type: 'WEEKLY' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    await ctx.reply(
      'Creation cancelled.',
      buildWeeklyKeyboard(sortWeeklyBlocks(blocks))
    );
    return;
  }

  if (step === 'name') {
    const existingCount = await QuestionBlockModel.countDocuments({
      userId,
      type: 'WEEKLY',
    }).exec();
    if (existingCount >= maxBlocks) {
      pendingActions.delete(ctx.from!.id);
      await ctx.reply(
        'You already have 3 weekly sets. Delete one to add another.',
        buildWeeklyKeyboard()
      );
      return;
    }

    const name = messageText.trim();
    if (!name) {
      await ctx.reply('Name cannot be empty.', buildWeeklyCreateKeyboard());
      return;
    }
    pendingActions.set(ctx.from!.id, {
      ...pendingAction,
      step: 'slots',
      temp: { ...state, name },
    });
    await ctx.reply(
      'Send slots: morning, day, evening (comma-separated). At least one required.',
      buildWeeklyCreateKeyboard()
    );
    return;
  }

  if (step === 'slots') {
    const slots = parseSlotsFlag(messageText);
    if (!slots) {
      await ctx.reply(
        'Invalid slots. Use morning, day, evening separated by commas.',
        buildWeeklyCreateKeyboard()
      );
      return;
    }
    pendingActions.set(ctx.from!.id, {
      ...pendingAction,
      step: 'days',
      temp: { ...state, slots },
    });
    await ctx.reply(
      'Send days of week as numbers 1-7, comma-separated.',
      buildWeeklyCreateKeyboard()
    );
    return;
  }

  if (step === 'days') {
    const parsed = messageText
      .split(',')
      .map((d) => Number.parseInt(d.trim(), 10))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
    if (!parsed.length) {
      await ctx.reply(
        'Provide days 1-7 separated by commas.',
        buildWeeklyCreateKeyboard()
      );
      return;
    }
    pendingActions.set(ctx.from!.id, {
      ...pendingAction,
      step: 'q1',
      temp: { ...state, days: parsed },
    });
    await ctx.reply('Question 1:', buildWeeklyCreateKeyboard());
    return;
  }

  const pushQuestion = (key: 'q1' | 'q2' | 'q3', nextStep: string | null) => {
    const text = messageText.trim();
    if (!text) {
      void ctx.reply('Question text cannot be empty.', buildWeeklyCreateKeyboard());
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
      void ctx.reply(label, buildWeeklyCreateKeyboard());
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
      // keep current state
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
        await ctx.reply('Question text cannot be empty.', buildWeeklyCreateKeyboard());
        return;
      }
      state = { ...state, q3: text };
    }
  }

  const questions = [state.q1, state.q2, state.q3].filter(Boolean) as string[];
  if (!state.name || !state.slots || !state.days) {
    await ctx.reply('Something went wrong. Please start creation again with the Add button.', buildWeeklyKeyboard());
    pendingActions.delete(ctx.from!.id);
    return;
  }
  if (!questions.length) {
    await ctx.reply('At least one question is required.', buildWeeklyCreateKeyboard());
    return;
  }

  await QuestionBlockModel.create({
    userId,
    type: 'WEEKLY',
    name: state.name,
    slots: state.slots,
    daysOfWeek: state.days,
    questions: questions.map((text, idx) => ({
      key: `q${idx + 1}`,
      text,
      order: idx,
    })),
  });

  pendingActions.delete(ctx.from!.id);
  const blocks = await QuestionBlockModel.find({ userId, type: 'WEEKLY' })
    .sort({ createdAt: 1 })
    .lean()
    .exec();
  await ctx.reply(
    `Weekly set "${state.name}" created.`,
    buildWeeklyKeyboard(sortWeeklyBlocks(blocks))
  );
}
