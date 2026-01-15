import type { Context } from 'telegraf';
import mongoose from 'mongoose';

import { QuestionBlockModel } from '../models/questionBlock.model.js';
import { UserModel } from '../models/user.model.js';
import { pendingActions } from '../state/pending.js';
import {
  DAILY_EDIT_ACTION_BUTTONS,
  CLEAR_QUESTION_BUTTON_LABEL,
  buildDailyEditKeyboard,
  buildDailyCreateKeyboard,
  buildDailyKeyboard,
} from '../ui/keyboards.js';
import { resetNavigation } from '../state/navigation.js';
import { getSlotLabel } from '../utils/format.js';
import { slotCodeFromString } from '../utils/time.js';
import type { SlotCode } from '../types/core.js';

function sortDailyBlocks(blocks: Array<{ slots: any; name: string }>) {
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

export async function startDailyEditFlow(
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
  const dailyBlocks = await QuestionBlockModel.find({
    userId: user._id,
    type: 'DAILY',
  })
    .sort({ createdAt: 1 })
    .lean()
    .exec();

  const sorted = [...dailyBlocks].sort((a, b) => {
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
    await ctx.reply('This daily set does not exist. Try another.');
    return;
  }

  pendingActions.set(from.id, {
    type: 'editDaily',
    step: 'menu',
    blockId: block._id.toString(),
    blockName: block.name,
  });

  await ctx.reply(
    `Editing daily set "${block.name}".\nChoose what to change: slot, name, or any question.`,
    buildDailyEditKeyboard()
  );
}

export async function startDailyCreateFlow(ctx: Context): Promise<void> {
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
    type: 'DAILY',
  }).exec();

  if (count >= 3) {
    await ctx.reply(
      'You already have 3 daily sets. Delete one to add another.',
      buildDailyKeyboard()
    );
    return;
  }

  pendingActions.set(from.id, {
    type: 'createDaily',
    step: 'name',
    temp: {},
  });

  await ctx.reply(
    'Enter a name for the new daily set:',
    buildDailyCreateKeyboard()
  );
}

export async function handleEditDailyFlow(
  ctx: Context,
  userId: mongoose.Types.ObjectId,
  messageText: string,
  pendingAction: Extract<
    import('../state/pending.js').PendingAction,
    { type: 'editDaily' }
  >
): Promise<void> {
  const block = await QuestionBlockModel.findOne({
    _id: pendingAction.blockId,
    userId,
    type: 'DAILY',
  }).exec();

  if (!block) {
    pendingActions.delete(ctx.from!.id);
    await ctx.reply('This daily set no longer exists.', buildDailyKeyboard());
    return;
  }

  const input = messageText.trim().toLowerCase();

  if (pendingAction.step === 'menu') {
    if (input === 'back' || input === DAILY_EDIT_ACTION_BUTTONS.back.toLowerCase()) {
      pendingActions.delete(ctx.from!.id);
      const blocks = await QuestionBlockModel.find({ userId, type: 'DAILY' })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
      await ctx.reply('Back.', buildDailyKeyboard(sortDailyBlocks(blocks)));
      return;
    }
    if (input === 'delete' || input === DAILY_EDIT_ACTION_BUTTONS.delete.toLowerCase()) {
      await QuestionBlockModel.deleteOne({ _id: block._id }).exec();
      pendingActions.delete(ctx.from!.id);
      resetNavigation(ctx.from!.id);
      const blocks = await QuestionBlockModel.find({ userId, type: 'DAILY' })
        .sort({ createdAt: 1 })
        .lean()
        .exec();
      await ctx.reply(
        'Deleted daily set.',
        buildDailyKeyboard(sortDailyBlocks(blocks))
      );
      return;
    }
    if (input === 'slot' || input === DAILY_EDIT_ACTION_BUTTONS.slot.toLowerCase()) {
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'setSlot' });
      await ctx.reply('Send slot: MORNING | DAY | EVENING', buildDailyEditKeyboard());
      return;
    }
    if (input === 'name' || input === DAILY_EDIT_ACTION_BUTTONS.name.toLowerCase()) {
      pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'setName' });
      await ctx.reply('Send new name:', buildDailyEditKeyboard());
      return;
    }
    if (['q1', 'q2', 'q3'].includes(input) || 
        input === DAILY_EDIT_ACTION_BUTTONS.q1.toLowerCase() ||
        input === DAILY_EDIT_ACTION_BUTTONS.q2.toLowerCase() ||
        input === DAILY_EDIT_ACTION_BUTTONS.q3.toLowerCase()) {
      const stepMap: Record<string, 'setQ1' | 'setQ2' | 'setQ3'> = {
        'q1': 'setQ1',
        'q2': 'setQ2',
        'q3': 'setQ3',
        [DAILY_EDIT_ACTION_BUTTONS.q1.toLowerCase()]: 'setQ1',
        [DAILY_EDIT_ACTION_BUTTONS.q2.toLowerCase()]: 'setQ2',
        [DAILY_EDIT_ACTION_BUTTONS.q3.toLowerCase()]: 'setQ3',
      };
      pendingActions.set(ctx.from!.id, {
        ...pendingAction,
        step: stepMap[input] || 'setQ1',
      });
      await ctx.reply(
        'Send new question text, or type "skip" to clear this question.',
        buildDailyEditKeyboard(true)
      );
      return;
    }
    await ctx.reply(
      'Unknown action. Use buttons or send: slot | name | q1 | q2 | q3 | delete | back',
      buildDailyEditKeyboard()
    );
    return;
  }

  if (pendingAction.step === 'setSlot') {
    const slot = slotCodeFromString(messageText);
    if (!slot) {
      await ctx.reply(
        'Unknown slot. Use MORNING, DAY, or EVENING.',
        buildDailyEditKeyboard()
      );
      return;
    }
    block.slots = {
      morning: slot === 'MORNING',
      day: slot === 'DAY',
      evening: slot === 'EVENING',
    };
    await block.save();
    pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'menu' });
    await ctx.reply(
      `Slot updated to ${getSlotLabel(slot)}. Choose next action:`,
      buildDailyEditKeyboard()
    );
    return;
  }

  if (pendingAction.step === 'setName') {
    const name = messageText.trim();
    if (!name) {
      await ctx.reply('Name cannot be empty.', buildDailyEditKeyboard());
      return;
    }
    block.name = name;
    await block.save();
    pendingActions.set(ctx.from!.id, { ...pendingAction, step: 'menu' });
    await ctx.reply('Name updated. Choose next action:', buildDailyEditKeyboard());
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
        buildDailyEditKeyboard()
      );
      return;
    }

    if (!text) {
      await ctx.reply(
        'Question text cannot be empty.',
        buildDailyEditKeyboard(true)
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
      buildDailyEditKeyboard()
    );
  };

  if (pendingAction.step === 'setQ1') return updateQuestion(0);
  if (pendingAction.step === 'setQ2') return updateQuestion(1);
  if (pendingAction.step === 'setQ3') return updateQuestion(2);
}

export async function handleCreateDailyFlow(
  ctx: Context,
  userId: mongoose.Types.ObjectId,
  messageText: string,
  pendingAction: Extract<
    import('../state/pending.js').PendingAction,
    { type: 'createDaily' }
  >
): Promise<void> {
  const maxBlocks = 3;
  let state = { ...(pendingAction.temp || {}) };
  const step = pendingAction.step;
  const input = messageText.trim().toLowerCase();

  if (
    input === 'delete' ||
    input === DAILY_EDIT_ACTION_BUTTONS.delete.toLowerCase()
  ) {
    pendingActions.delete(ctx.from!.id);
    resetNavigation(ctx.from!.id);
    const blocks = await QuestionBlockModel.find({ userId, type: 'DAILY' })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    await ctx.reply(
      'Creation cancelled.',
      buildDailyKeyboard(sortDailyBlocks(blocks))
    );
    return;
  }

  if (step === 'name') {
    const existingCount = await QuestionBlockModel.countDocuments({
      userId,
      type: 'DAILY',
    }).exec();
    if (existingCount >= maxBlocks) {
      pendingActions.delete(ctx.from!.id);
      await ctx.reply(
        'You already have 3 daily sets. Delete one to add another.',
        buildDailyKeyboard()
      );
      return;
    }

    const name = messageText.trim();
    if (!name) {
      await ctx.reply('Name cannot be empty.', buildDailyCreateKeyboard());
      return;
    }
    pendingActions.set(ctx.from!.id, {
      ...pendingAction,
      step: 'slot',
      temp: { ...state, name },
    });
    await ctx.reply(
      'Choose slot: MORNING | DAY | EVENING',
      buildDailyCreateKeyboard()
    );
    return;
  }

  if (step === 'slot') {
    const slot = slotCodeFromString(messageText);
    if (!slot) {
      await ctx.reply(
        'Unknown slot. Use MORNING, DAY, or EVENING.',
        buildDailyCreateKeyboard()
      );
      return;
    }
    pendingActions.set(ctx.from!.id, {
      ...pendingAction,
      step: 'q1',
      temp: { ...state, slot },
    });
    await ctx.reply('Question 1:', buildDailyCreateKeyboard());
    return;
  }

  const pushQuestion = (key: 'q1' | 'q2' | 'q3', nextStep: string | null) => {
    const text = messageText.trim();
    if (!text) {
      void ctx.reply('Question text cannot be empty.', buildDailyCreateKeyboard());
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
      void ctx.reply(label, buildDailyCreateKeyboard());
      return true;
    }
    return nextTemp;
  };

  if (step === 'q1') {
    const tmp = pushQuestion('q1', 'q2');
    if (tmp === true) return;
    if (!tmp) return;
    state = tmp;
    return;
  }

  if (step === 'q2') {
    if (messageText.trim().toLowerCase() === 'skip') {
      // keep current state, proceed to finalize
    } else {
      const res = pushQuestion('q2', 'q3');
      if (res === true) return;
      if (!res) return;
      state = res;
      return;
    }
  }

  if (step === 'q3') {
    if (messageText.trim().toLowerCase() !== 'skip') {
      const text = messageText.trim();
      if (!text) {
        await ctx.reply('Question text cannot be empty.', buildDailyCreateKeyboard());
        return;
      }
      state = { ...state, q3: text };
    }
  }

  // Finalize creation
  const questions = [state.q1, state.q2, state.q3].filter(Boolean) as string[];
  if (!state.name || !state.slot) {
    await ctx.reply('Something went wrong. Please start creation again with the Add button.', buildDailyKeyboard());
    pendingActions.delete(ctx.from!.id);
    return;
  }
  if (!questions.length) {
    await ctx.reply('At least one question is required.', buildDailyCreateKeyboard());
    return;
  }

  await QuestionBlockModel.create({
    userId,
    type: 'DAILY',
    name: state.name,
    slots: {
      morning: state.slot === 'MORNING',
      day: state.slot === 'DAY',
      evening: state.slot === 'EVENING',
    },
    questions: questions.map((text, idx) => ({
      key: `q${idx + 1}`,
      text,
      order: idx,
    })),
  });

  pendingActions.delete(ctx.from!.id);
  const blocks = await QuestionBlockModel.find({ userId, type: 'DAILY' })
    .sort({ createdAt: 1 })
    .lean()
    .exec();
  await ctx.reply(
    `Daily set "${state.name}" created.`,
    buildDailyKeyboard(sortDailyBlocks(blocks))
  );
}
