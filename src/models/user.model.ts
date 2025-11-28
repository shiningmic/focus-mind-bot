import { Schema, model, type Document, type Model } from 'mongoose';
import type { SlotCode, SlotMode } from '../types/core.js';

// Embedded slot configuration
export interface SlotConfig {
  slot: SlotCode;
  mode: SlotMode;
  timeMinutes?: number; // for FIXED mode
  windowStartMinutes?: number; // for RANDOM_WINDOW
  windowEndMinutes?: number; // for RANDOM_WINDOW
}

export interface UserDocument extends Document {
  telegramId: number;
  timezone: string;
  slots: SlotConfig[];
  createdAt: Date;
  updatedAt: Date;
}

// SlotConfig sub-schema (no separate _id)
const SlotConfigSchema = new Schema<SlotConfig>(
  {
    slot: {
      type: String,
      enum: ['MORNING', 'DAY', 'EVENING'],
      required: true,
    },
    mode: {
      type: String,
      enum: ['FIXED', 'RANDOM_WINDOW'],
      required: true,
    },
    timeMinutes: {
      type: Number,
      required: false,
      min: 0,
      max: 24 * 60 - 1,
    },
    windowStartMinutes: {
      type: Number,
      required: false,
      min: 0,
      max: 24 * 60 - 1,
    },
    windowEndMinutes: {
      type: Number,
      required: false,
      min: 0,
      max: 24 * 60 - 1,
    },
  },
  {
    _id: false,
  }
);

const UserSchema = new Schema<UserDocument>(
  {
    telegramId: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    timezone: {
      type: String,
      required: true,
    },
    slots: {
      type: [SlotConfigSchema],
      required: true,
      validate: {
        validator(value: SlotConfig[]) {
          // We expect exactly 3 slot configs: MORNING, DAY, EVENING
          return Array.isArray(value) && value.length === 3;
        },
        message: 'User must have exactly 3 slot configurations',
      },
    },
  },
  {
    timestamps: true,
  }
);

export const UserModel: Model<UserDocument> = model<UserDocument>(
  'User',
  UserSchema
);
