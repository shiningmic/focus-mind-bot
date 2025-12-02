import 'dotenv/config';
import mongoose from 'mongoose';

import { SessionModel } from '../src/models/session.model.js';

async function main(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error('MONGODB_URI is not defined');
  }

  await mongoose.connect(mongoUri);
  console.log('✅ Connected to MongoDB, syncing session indexes...');

  try {
    await SessionModel.syncIndexes();
    console.log('✅ Session indexes are in sync with the schema (unique per user/slot/dateKey).');
  } catch (error) {
    console.error('❌ Failed to sync session indexes. Check for duplicate sessions.', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB.');
  }
}

void main().catch((err) => {
  console.error('❌ Unexpected error while syncing session indexes:', err);
  process.exit(1);
});
