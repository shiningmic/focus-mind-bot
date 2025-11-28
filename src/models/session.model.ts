import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import type { SlotCode, SessionStatus, QuestionType } from '../types/core.js';

export interface SessionQuestion {
  key: string; // from QuestionItem.key
  text: string; // final text shown to user
  sourceType: QuestionType; // DAILY | WEEKLY | MONTHLY
  blockId: Types.ObjectId; // source QuestionBlock
  order: number; // order inside the whole session
}

export interface SessionAnswer {
  key: string; // matches SessionQuestion.key
  text: string; // user answer
  createdAt: Date;
}

export interface SessionDocument extends Document {
  userId: Types.ObjectId;
  slot: SlotCode;

  dateKey: string; // "YYYY-MM-DD" in user timezone
  status: SessionStatus;

  questions: SessionQuestion[];
  currentQuestionIndex: number;
  answers: SessionAnswer[];

  startedAt?: Date;
  lastInteractionAt?: Date;
  finishedAt?: Date;
}

// SessionQuestion sub-schema
const SessionQuestionSchema = new Schema<SessionQuestion>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    sourceType: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'MONTHLY'],
      required: true,
    },
    blockId: {
      type: Schema.Types.ObjectId,
      ref: 'QuestionBlock',
      required: true,
    },
    order: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

// SessionAnswer sub-schema
const SessionAnswerSchema = new Schema<SessionAnswer>(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  { _id: false }
);

const SessionSchema = new Schema<SessionDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    slot: {
      type: String,
      enum: ['MORNING', 'DAY', 'EVENING'],
      required: true,
    },
    dateKey: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'skipped', 'expired'],
      required: true,
      default: 'pending',
    },
    questions: {
      type: [SessionQuestionSchema],
      required: true,
    },
    currentQuestionIndex: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    answers: {
      type: [SessionAnswerSchema],
      required: true,
      default: [],
    },
    startedAt: {
      type: Date,
      required: false,
    },
    lastInteractionAt: {
      type: Date,
      required: false,
    },
    finishedAt: {
      type: Date,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Optional: ensure one session per user/slot/date
SessionSchema.index({ userId: 1, slot: 1, dateKey: 1 }, { unique: false });

export const SessionModel: Model<SessionDocument> = model<SessionDocument>(
  'Session',
  SessionSchema
);
