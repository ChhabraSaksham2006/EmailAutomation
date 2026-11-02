import { HARD_LIMITS } from '@cold-outreach/shared';
import { Mailbox, SendLog, Event } from '../models/index.js';

/**
 * Resets mailbox `sentToday` counter if `lastResetDate` is from a previous UTC day.
 */
export async function ensureMailboxDailyReset(mailbox) {
  const todayStr = new Date().toISOString().slice(0, 10);
  if (mailbox.lastResetDate !== todayStr) {
    mailbox.sentToday = 0;
    mailbox.lastResetDate = todayStr;
    await mailbox.save();
  }
  return mailbox;
}

/**
 * Recomputes the mailbox's rolling 7-day bounce rate and total complaints.
 * If rolling 7-day bounce rate >= 3% (with a minimum sample of sends or any hard threshold)
 * or if any spam complaint is recorded, sets mailbox status to `paused`.
 */
export async function evaluateMailboxCircuitBreaker(mailboxId) {
  const mailbox = await Mailbox.findById(mailboxId);
  if (!mailbox) return null;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [sent7d, bounces7d, complaintsCount] = await Promise.all([
    SendLog.countDocuments({
      mailboxId: mailbox._id,
      error: null,
      sentAt: { $gte: sevenDaysAgo }
    }),
    Event.countDocuments({
      mailboxId: mailbox._id,
      type: 'bounce',
      createdAt: { $gte: sevenDaysAgo }
    }),
    Event.countDocuments({
      mailboxId: mailbox._id,
      type: 'complaint'
    })
  ]);

  // Denominator uses at least sent7d (or sent7d + bounces7d if bounce happened before sendLog count)
  const denominator = Math.max(sent7d, bounces7d, 1);
  const bounceRate7d = bounces7d / denominator;

  mailbox.health = {
    sent7d,
    bounces7d,
    bounceRate7d: Number(bounceRate7d.toFixed(4)),
    complaintsCount,
    lastPausedReason: mailbox.health?.lastPausedReason || '',
    lastCheckedAt: new Date()
  };

  let shouldPause = false;
  let pauseReason = '';

  if (complaintsCount >= HARD_LIMITS.MAX_COMPLAINTS_BEFORE_PAUSE) {
    shouldPause = true;
    pauseReason = `Auto-paused: ${complaintsCount} spam complaint(s) recorded (0 complaint tolerance).`;
  } else if (bounces7d > 0 && bounceRate7d >= HARD_LIMITS.PAUSE_BOUNCE_RATE) {
    shouldPause = true;
    pauseReason = `Auto-paused: Rolling 7-day bounce rate reached ${(bounceRate7d * 100).toFixed(1)}% (${bounces7d}/${denominator}), exceeding the ${(HARD_LIMITS.PAUSE_BOUNCE_RATE * 100).toFixed(0)}% threshold.`;
  }

  if (shouldPause && mailbox.status !== 'paused') {
    mailbox.status = 'paused';
    mailbox.health.lastPausedReason = pauseReason;

    await Event.create({
      userId: mailbox.userId,
      type: 'error',
      mailboxId: mailbox._id,
      subject: `Circuit Breaker Triggered for ${mailbox.address}`,
      snippet: pauseReason,
      rawPayloadSummary: {
        sent7d,
        bounces7d,
        bounceRate7d,
        complaintsCount,
        alertEmail: process.env.ALERT_EMAIL || null
      }
    });
  }

  await mailbox.save();
  return {
    mailbox,
    paused: shouldPause,
    pauseReason
  };
}
