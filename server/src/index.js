import './loadEnv.js';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import {
  runSchedulerTick,
  pollAllMailboxesForRepliesAndBounces
} from './services/sendingEngineService.js';

const PORT = Number(process.env.PORT || 4000);
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/cold-outreach';

async function start() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log(`[server] Connected to MongoDB`);

    const app = createApp();
    app.listen(PORT, () => {
      console.log(`[server] Cold Outreach API listening on http://localhost:${PORT}`);
    });

    // Embedded scheduler (every 15s) & poller (every 4m) enabled by default unless explicitly disabled
    if (process.env.ENABLE_EMBEDDED_WORKER !== 'false') {
      console.log('[server] Background scheduler (15s tick, 30s-2m email gap) & inbox poller active');
      setInterval(() => {
        runSchedulerTick().catch((err) => console.error('[embedded-scheduler]', err.message));
      }, 15 * 1000);

      setInterval(() => {
        pollAllMailboxesForRepliesAndBounces().catch((err) => console.error('[embedded-poller]', err.message));
      }, 4 * 60 * 1000);
    }
  } catch (err) {
    console.error('[server] Failed to start:', err);
    process.exit(1);
  }
}

start();
