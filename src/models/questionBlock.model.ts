// src/models/questionBlock.model.ts
import { Schema, model, type Document, type Model, type Types } from 'mongoose';
import type {
  QuestionItem,
  QuestionType,
  MonthSchedule,
} from '../types/core.js';

// Question block document
export interface QuestionBlockDocument extends Document {
  userId: Types.ObjectId;
  type: QuestionType;
  name: string;

  slots: {
    morning: boolean;
    day: boolean;
    evening: boolean;
  };

  questions: QuestionItem[];

  // Weekly-specific
  daysOfWeek?: number[]; // 1 = Monday, 7 = Sunday

  // Monthly-specific
  monthSchedule?: MonthSchedule;

  createdAt: Date;
  updatedAt: Date;
}

// QuestionItem sub-schema
const QuestionItemSchema = new Schema<QuestionItem>(
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
    order: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

// MonthSchedule sub-schema
const MonthScheduleSchema = new Schema<MonthSchedule>(
  {
    kind: {
      type: String,
      enum: ['DAY_OF_MONTH', 'FIRST_DAY', 'LAST_DAY'],
      required: true,
    },
    dayOfMonth: {
      type: Number,
      required: false,
      min: 1,
      max: 28, // safe range to avoid month length issues
    },
  },
  { _id: false }
);

const QuestionBlockSchema = new Schema<QuestionBlockDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['DAILY', 'WEEKLY', 'MONTHLY'],
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slots: {
      morning: { type: Boolean, required: true, default: false },
      day: { type: Boolean, required: true, default: false },
      evening: { type: Boolean, required: true, default: false },
    },
    questions: {
      type: [QuestionItemSchema],
      required: true,
      validate: {
        validator(value: QuestionItem[]) {
          return Array.isArray(value) && value.length > 0 && value.length <= 3;
        },
        message: 'Question block must contain between 1 and 3 questions',
      },
    },
    daysOfWeek: {
      type: [Number],
      required: false,
      validate: {
        validator(value: number[] | undefined) {
          if (!value) return true;
          return value.every(
            (day) => Number.isInteger(day) && day >= 1 && day <= 7
          );
        },
        message: 'daysOfWeek must contain integers between 1 and 7',
      },
    },
    monthSchedule: {
      type: MonthScheduleSchema,
      required: false,
    },
  },
  {
    timestamps: true,
  }
);

// Optional: index to quickly find blocks by user/type
QuestionBlockSchema.index({ userId: 1, type: 1 });

export const QuestionBlockModel: Model<QuestionBlockDocument> =
  model<QuestionBlockDocument>('QuestionBlock', QuestionBlockSchema);
