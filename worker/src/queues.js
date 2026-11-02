import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import {
  processEnrollmentSend,
  runSchedulerTick,
  pollAllMailboxesForRepliesAndBounces
} from '@cold-outreach/server';

export const SEND_QUEUE_NAME = 'outreach-send-queue';

/**
 * Starts the BullMQ queues and processors when Redis is available,
 * or falls back cleanly to in-process timers if Redis is not running locally.
 */
export async function startWorkerEngine({ redisUrl = process.env.REDIS_URL } = {}) {
  let connection = null;

  if (redisUrl) {
    try {
      const testConn = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,
        connectTimeout: 4000,
        lazyConnect: true
      });
      await testConn.connect();
      connection = testConn;
      console.log('[worker] Connected to Redis for BullMQ queues');
    } catch (err) {
      console.warn(`[worker] Redis unavailable (${err.message}); falling back to in-process scheduler & sender.`);
      connection = null;
    }
  }

  let sendQueue = null;
  let sendWorker = null;

  if (connection) {
    sendQueue = new Queue(SEND_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        // Section 7: Retry temporary errors with exponential backoff, maximum 3 tries
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 30000
        },
        removeOnComplete: 500,
        removeOnFail: 1000
      }
    });

    sendWorker = new Worker(
      SEND_QUEUE_NAME,
      async (job) => {
        const { enrollmentId } = job.data;
        return processEnrollmentSend(enrollmentId);
      },
      {
        connection,
        concurrency: 5
      }
    );

    sendWorker.on('completed', (job, result) => {
      if (result?.sent) {
        console.log(`[worker] Sent job ${job.id} (gmailMessageId=${result.gmailMessageId})`);
      }
    });

    sendWorker.on('failed', (job, err) => {
      console.error(`[worker] Send job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`);
    });
  }

  // Enqueue helper passed to Scheduler
  const enqueueFn = async (enrollmentId, delayMs = 0) => {
    if (sendQueue) {
      await sendQueue.add(
        'send-step',
        { enrollmentId: String(enrollmentId) },
        {
          delay: Math.max(0, delayMs),
          jobId: `send-${enrollmentId}-${Date.now()}`
        }
      );
    } else {
      setTimeout(() => {
        processEnrollmentSend(enrollmentId).catch((err) => {
          console.error('[worker-fallback] send error:', err.message);
        });
      }, Math.max(0, delayMs));
    }
  };

  // Run initial scheduler tick & poller pass on startup
  await runSchedulerTick({ enqueueFn });
  await pollAllMailboxesForRepliesAndBounces();

  // Scheduler runs every 15 seconds in the worker to support 30s-2m pacing accurately
  const schedulerInterval = setInterval(async () => {
    try {
      const res = await runSchedulerTick({ enqueueFn });
      if (res.scheduledCount > 0) {
        console.log(`[scheduler] Enqueued ${res.scheduledCount} outreach sends`);
      }
    } catch (err) {
      console.error('[scheduler] Tick error:', err.message);
    }
  }, 15 * 1000);

  // Section 8: Every 3 to 5 minutes, poll each mailbox for replies and bounces
  const pollerInterval = setInterval(async () => {
    try {
      await pollAllMailboxesForRepliesAndBounces();
    } catch (err) {
      console.error('[poller] Poll error:', err.message);
    }
  }, 4 * 60 * 1000);

  return {
    sendQueue,
    sendWorker,
    stop: async () => {
      clearInterval(schedulerInterval);
      clearInterval(pollerInterval);
      if (sendWorker) await sendWorker.close();
      if (sendQueue) await sendQueue.close();
      if (connection) await connection.quit();
    }
  };
}
