import '@cold-outreach/server';
import mongoose from 'mongoose';
import { startWorkerEngine } from './queues.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cold-outreach';

async function main() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('[worker] Connected to MongoDB');

    const engine = await startWorkerEngine();
    console.log('[worker] Cold Outreach background worker running (Scheduler: 1m, Inbox Poller: 4m)');

    const shutdown = async () => {
      console.log('[worker] Shutting down...');
      await engine.stop();
      await mongoose.disconnect();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[worker] Fatal startup error:', err);
    process.exit(1);
  }
}

main();
