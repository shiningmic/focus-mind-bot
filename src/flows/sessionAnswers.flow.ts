import type { Context } from 'telegraf';
import mongoose from 'mongoose';

import { SessionModel } from '../models/session.model.js';
import { UserModel } from '../models/user.model.js';
import { buildMainKeyboard } from '../ui/keyboards.js';
import {
  buildQuestionPrompt,
  buildSessionCompletionSummary,
} from '../utils/format.js';
import { getDateKeyForTimezone } from '../utils/time.js';
import { DEFAULT_TIMEZONE } from '../config/constants.js';

export async function handleSessionAnswer(
  ctx: Context,
  userId: mongoose.Types.ObjectId,
  messageText: string
): Promise<void> {
  const user = await UserModel.findOne({ _id: userId }).exec();
  if (!user) {
    await ctx.reply(
      'You do not have a Focus Mind profile yet. Send /start first.'
    );
    return;
  }

  const timezone = user.timezone || DEFAULT_TIMEZONE;
  const todayKey = getDateKeyForTimezone(timezone);

  const session = await SessionModel.findOne({
    userId: user._id,
    dateKey: todayKey,
    status: { $in: ['pending', 'in_progress'] },
  })
    .sort({ createdAt: -1 })
    .exec();

  if (!session) {
    await ctx.reply(
      'No active reflection session. Use /reflect to start one.',
      buildMainKeyboard()
    );
    return;
  }

  if (!session.questions.length) {
    await ctx.reply('No questions configured for this session.');
    return;
  }

  const index =
    typeof session.currentQuestionIndex === 'number'
      ? session.currentQuestionIndex
      : 0;

  const question = session.questions[index];

  const answerText = messageText.trim();
  if (!answerText) {
    await ctx.reply('Please enter a non-empty answer.');
    return;
  }

  // Remove existing answer for this question if any
  session.answers = session.answers.filter((a) => a.key !== question.key);
  session.answers.push({
    key: question.key,
    text: answerText,
    createdAt: new Date(),
  } as any);

  if (index + 1 >= session.questions.length) {
    session.status = 'completed';
    session.currentQuestionIndex = session.questions.length;
    session.lastInteractionAt = new Date();
    session.finishedAt = new Date();
    await session.save();
    await ctx.reply(buildSessionCompletionSummary(session), {
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  session.currentQuestionIndex = index + 1;
  session.status = 'in_progress';
  session.lastInteractionAt = new Date();
  session.startedAt ||= new Date();
  await session.save();

  const nextQuestion = session.questions[session.currentQuestionIndex];
  await ctx.reply(
    buildQuestionPrompt(
      session.slot,
      nextQuestion.text,
      session.currentQuestionIndex,
      session.questions.length
    )
  );
}
