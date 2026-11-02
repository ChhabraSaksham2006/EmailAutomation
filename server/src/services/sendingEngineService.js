import {
  renderStepEmail,
  isWithinSendWindow,
  getNextValidSendWindowDate,
  getRandomPacingMs,
  OPT_OUT_KEYWORDS,
  AUTO_REPLY_SUBJECT_PATTERNS,
  BOUNCE_SENDER_PATTERNS,
  normalizeEmail
} from '@cold-outreach/shared';
import {
  Campaign,
  Sequence,
  Mailbox,
  Contact,
  Enrollment,
  SendLog,
  Event,
  ComplianceConfig
} from '../models/index.js';
import { isEmailSuppressed, addSuppression } from './suppressionService.js';
import { sendViaGmailApi, getGmailClientForMailbox } from './gmailService.js';
import { ensureMailboxDailyReset, evaluateMailboxCircuitBreaker } from './circuitBreakerService.js';
import { buildSenderContextForMailbox } from './gateCheckService.js';

/**
 * Processes a single Enrollment step send with strict idempotency, pre-send re-verification,
 * RFC 8058 List-Unsubscribe headers, thread continuation, and circuit breaker updates.
 */
export async function processEnrollmentSend(enrollmentId, { ignoreSendWindow = false } = {}) {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment || enrollment.status !== 'active') {
    return { skipped: true, reason: 'enrollment_not_active' };
  }

  const stepIndex = enrollment.currentStep;

  // 1. Idempotency check: has this (enrollmentId, step) already been sent?
  const existingLog = await SendLog.findOne({
    enrollmentId: enrollment._id,
    step: stepIndex
  }).lean();

  if (existingLog && !existingLog.error) {
    return { skipped: true, reason: 'already_sent_idempotent', sendLogId: existingLog._id };
  }

  const [campaign, contact, mailbox] = await Promise.all([
    Campaign.findById(enrollment.campaignId),
    Contact.findById(enrollment.contactId),
    Mailbox.findById(enrollment.mailboxId).select('+encryptedCredentials')
  ]);

  if (!campaign || campaign.status !== 'running') {
    return { skipped: true, reason: 'campaign_not_running' };
  }
  if (!contact) {
    enrollment.status = 'failed';
    enrollment.lastError = 'Contact missing';
    await enrollment.save();
    return { skipped: true, reason: 'contact_missing' };
  }
  if (!mailbox || mailbox.status !== 'active') {
    return { skipped: true, reason: 'mailbox_not_active' };
  }

  // 2. Re-check global suppression and contact status right before sending (Section 7)
  const supCheck = await isEmailSuppressed(contact.email);
  if (supCheck.suppressed || contact.status !== 'active') {
    const newStatus = supCheck.reason === 'bounce' || contact.status === 'bounced'
      ? 'bounced'
      : contact.status === 'replied'
        ? 'replied'
        : 'opted_out';
    enrollment.status = newStatus;
    await enrollment.save();
    return { skipped: true, reason: `contact_${newStatus}` };
  }

  // 3. Re-check mailbox daily cap
  await ensureMailboxDailyReset(mailbox);
  if (mailbox.sentToday >= mailbox.dailyCap) {
    // Roll to next day's window
    const tomorrow = new Date(Date.now() + 18 * 60 * 60 * 1000);
    enrollment.nextSendAt = tomorrow;
    await enrollment.save();
    return { skipped: true, reason: 'daily_cap_reached' };
  }

  const [sequence, complianceConfig] = await Promise.all([
    Sequence.findById(campaign.sequenceId).lean(),
    ComplianceConfig.findOne({ userId: campaign.userId }).lean()
  ]);

  if (!sequence || !sequence.steps?.[stepIndex]) {
    enrollment.status = 'completed';
    await enrollment.save();
    return { skipped: true, reason: 'no_more_steps' };
  }

  // Check recipient's local send window unless overridden
  if (!ignoreSendWindow && !isWithinSendWindow(new Date(), contact.timezone, sequence.sendWindow)) {
    enrollment.nextSendAt = getNextValidSendWindowDate(new Date(), contact.timezone, sequence.sendWindow);
    await enrollment.save();
    return { skipped: true, reason: 'outside_recipient_send_window', nextSendAt: enrollment.nextSendAt };
  }

  const step = sequence.steps[stepIndex];
  const senderContext = buildSenderContextForMailbox(
    mailbox,
    complianceConfig,
    contact,
    campaign._id,
    enrollment._id
  );

  // 4. Render subject and body; abort if any required variable is empty
  const rendered = renderStepEmail({
    step,
    contact,
    senderContext,
    appendFooterIfMissing: true
  });

  if (rendered.missingVariables.length > 0) {
    const errText = `Missing required variables at send time: ${rendered.missingVariables.join(', ')}`;
    enrollment.status = 'failed';
    enrollment.lastError = errText;
    await enrollment.save();
    await Event.create({
      userId: campaign.userId,
      type: 'error',
      enrollmentId: enrollment._id,
      campaignId: campaign._id,
      contactId: contact._id,
      mailboxId: mailbox._id,
      subject: 'Send Aborted: Missing Personalization Variables',
      snippet: errText
    });
    return { skipped: true, reason: 'missing_variables', missingVariables: rendered.missingVariables };
  }

  // 5. Build and send plain-text MIME message (threading follow-ups on same threadId)
  try {
    const sendResult = await sendViaGmailApi({
      mailbox,
      toAddress: contact.email,
      toName: contact.firstName || '',
      subject: rendered.subject,
      textBody: rendered.body,
      unsubscribeHttpsUrl: senderContext.unsubscribeUrl,
      threadId: stepIndex > 0 ? enrollment.threadId : null,
      inReplyTo: stepIndex > 0 ? enrollment.lastRfc822MessageId : null,
      references: stepIndex > 0 ? enrollment.messageReferences : [],
      enrollmentId: enrollment._id,
      campaignId: campaign._id
    });

    // 6. Write unique SendLog(enrollmentId, step)
    const sendLog = await SendLog.findOneAndUpdate(
      { enrollmentId: enrollment._id, step: stepIndex },
      {
        $set: {
          campaignId: campaign._id,
          mailboxId: mailbox._id,
          contactId: contact._id,
          gmailMessageId: sendResult.gmailMessageId,
          threadId: sendResult.threadId,
          rfc822MessageId: sendResult.rfc822MessageId,
          subject: rendered.subject,
          sentAt: new Date(),
          error: null
        }
      },
      { upsert: true, new: true }
    );

    // Update mailbox daily counter
    mailbox.sentToday += 1;
    await mailbox.save();

    // Update enrollment threading and advance to next step or complete
    enrollment.threadId = sendResult.threadId;
    enrollment.lastMessageId = sendResult.gmailMessageId;
    enrollment.lastRfc822MessageId = sendResult.rfc822MessageId;
    if (sendResult.rfc822MessageId) {
      enrollment.messageReferences = [
        ...(enrollment.messageReferences || []),
        sendResult.rfc822MessageId
      ];
    }

    const nextStepIndex = stepIndex + 1;
    if (nextStepIndex < sequence.steps.length) {
      const nextStep = sequence.steps[nextStepIndex];
      const delayDays = Math.max(1, (nextStep.delayDays || nextStepIndex * 4) - (step.delayDays || 0));
      const rawNextDate = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000);
      enrollment.currentStep = nextStepIndex;
      enrollment.nextSendAt = getNextValidSendWindowDate(rawNextDate, contact.timezone, sequence.sendWindow);
    } else {
      enrollment.currentStep = nextStepIndex;
      enrollment.status = 'completed';
    }

    await enrollment.save();

    // Check if campaign has any remaining active enrollments
    const remainingActive = await Enrollment.countDocuments({
      campaignId: campaign._id,
      status: 'active'
    });
    if (remainingActive === 0 && campaign.status === 'running') {
      campaign.status = 'done';
      await campaign.save();
    }

    await evaluateMailboxCircuitBreaker(mailbox._id);

    return {
      sent: true,
      step: stepIndex,
      gmailMessageId: sendResult.gmailMessageId,
      threadId: sendResult.threadId,
      sendLogId: sendLog._id
    };
  } catch (err) {
    const statusCode = Number(err.code || err.status || 500);
    const errMsg = err.message || 'Unknown send error';

    // Invalid address / hard bounce errors (400 / 404 / 550): never retry, mark bounced & suppress
    const isInvalidRecipient =
      statusCode === 400 ||
      /invalid to header|recipient address rejected|user unknown|does not exist|550/i.test(errMsg);

    if (isInvalidRecipient) {
      await addSuppression({
        email: contact.email,
        reason: 'bounce',
        notes: `Hard bounce on send: ${errMsg}`
      });
      enrollment.status = 'bounced';
      enrollment.lastError = errMsg;
      await enrollment.save();

      await Event.create({
        userId: campaign.userId,
        type: 'bounce',
        enrollmentId: enrollment._id,
        campaignId: campaign._id,
        contactId: contact._id,
        mailboxId: mailbox._id,
        fromAddress: 'mailer-daemon@googlemail.com',
        subject: `Delivery Status Notification (Failure): ${contact.email}`,
        snippet: errMsg
      });

      await evaluateMailboxCircuitBreaker(mailbox._id);
      return { sent: false, permanentBounce: true, error: errMsg };
    }

    // Temporary errors (429, 5xx) - rethrow so BullMQ retries with exponential backoff
    if (statusCode === 429 || statusCode >= 500) {
      throw err;
    }

    enrollment.lastError = errMsg;
    await enrollment.save();
    throw err;
  }
}

/**
 * Scheduler tick (runs every minute):
 * Finds active enrollments where nextSendAt <= now, enforces recipient timezone sendWindow,
 * respects mailbox dailyCap, and paces sends with a random 2-6 minute gap per mailbox.
 */
export async function runSchedulerTick({ enqueueFn = null, ignoreSendWindow = false } = {}) {
  const now = new Date();
  const dueEnrollments = await Enrollment.find({
    status: 'active',
    nextSendAt: { $lte: now }
  })
    .sort({ nextSendAt: 1 })
    .limit(100);

  const scheduled = [];
  const skipped = [];

  // Track next available slot per mailbox during this tick for 2-6 min pacing
  const mailboxCursorMap = new Map();

  for (const enrollment of dueEnrollments) {
    const [campaign, contact, mailbox] = await Promise.all([
      Campaign.findById(enrollment.campaignId).lean(),
      Contact.findById(enrollment.contactId).lean(),
      Mailbox.findById(enrollment.mailboxId)
    ]);

    if (!campaign || campaign.status !== 'running') {
      skipped.push({ enrollmentId: enrollment._id, reason: 'campaign_not_running' });
      continue;
    }

    if (!contact || contact.status !== 'active') {
      enrollment.status = contact?.status || 'paused';
      await enrollment.save();
      skipped.push({ enrollmentId: enrollment._id, reason: 'contact_not_active' });
      continue;
    }

    const sup = await isEmailSuppressed(contact.email);
    if (sup.suppressed) {
      enrollment.status = sup.reason === 'bounce' ? 'bounced' : 'opted_out';
      await enrollment.save();
      skipped.push({ enrollmentId: enrollment._id, reason: 'suppressed' });
      continue;
    }

    if (!mailbox || mailbox.status !== 'active') {
      skipped.push({ enrollmentId: enrollment._id, reason: 'mailbox_not_active' });
      continue;
    }

    await ensureMailboxDailyReset(mailbox);
    if (mailbox.sentToday >= mailbox.dailyCap) {
      skipped.push({ enrollmentId: enrollment._id, reason: 'daily_cap_reached' });
      continue;
    }

    const sequence = await Sequence.findById(campaign.sequenceId).lean();
    if (!sequence) continue;

    if (!ignoreSendWindow && !isWithinSendWindow(now, contact.timezone, sequence.sendWindow)) {
      enrollment.nextSendAt = getNextValidSendWindowDate(now, contact.timezone, sequence.sendWindow);
      await enrollment.save();
      skipped.push({ enrollmentId: enrollment._id, reason: 'outside_send_window' });
      continue;
    }

    // Compute paced delay (30 seconds to 2 minutes random gap per mailbox)
    const mbKey = String(mailbox._id);
    const baseTime = Math.max(
      now.getTime(),
      mailbox.lastScheduledAt ? new Date(mailbox.lastScheduledAt).getTime() : 0,
      mailboxCursorMap.get(mbKey) || 0
    );

    const isFirstImmediate = baseTime <= now.getTime();
    const delayMs = isFirstImmediate ? 0 : Math.max(0, baseTime - now.getTime());
    const nextSlotTime = new Date((isFirstImmediate ? now.getTime() : baseTime) + getRandomPacingMs());

    mailboxCursorMap.set(mbKey, nextSlotTime.getTime());
    mailbox.lastScheduledAt = nextSlotTime;
    await mailbox.save();

    if (enqueueFn) {
      // Advance nextSendAt so the next tick doesn't double-schedule while queued in BullMQ/timer
      enrollment.nextSendAt = new Date(now.getTime() + delayMs + 15 * 60 * 1000);
      await enrollment.save();
      await enqueueFn(enrollment._id, delayMs);
    } else if (isFirstImmediate) {
      // Advance nextSendAt before sending
      enrollment.nextSendAt = new Date(now.getTime() + 15 * 60 * 1000);
      await enrollment.save();
      await processEnrollmentSend(enrollment._id, { ignoreSendWindow });
    } else {
      // Stagger subsequent contacts for this mailbox by 30s-2m so they send one by one on upcoming ticks
      enrollment.nextSendAt = new Date(baseTime);
      await enrollment.save();
    }

    scheduled.push({
      enrollmentId: enrollment._id,
      mailboxId: mailbox._id,
      delayMs
    });
  }

  return { scheduledCount: scheduled.length, skippedCount: skipped.length, scheduled, skipped };
}

/**
 * Processes an incoming email message (from Gmail Poller or Simulation/Webhook) for Reply,
 * Bounce, Out-of-Office Auto-Reply, and Spam Complaint detection (Section 8).
 */
export async function processIncomingMessage({
  mailboxId,
  threadId,
  gmailMessageId,
  fromAddress,
  subject = '',
  bodyText = '',
  headers = {},
  failedRecipientEmail = null,
  isComplaint = false
}) {
  const mailbox = await Mailbox.findById(mailboxId);
  if (!mailbox) {
    throw new Error('Mailbox not found');
  }

  // Deduplicate if gmailMessageId was already processed
  if (gmailMessageId) {
    const existing = await Event.findOne({ gmailMessageId }).lean();
    if (existing) {
      return { duplicate: true, event: existing };
    }
  }

  const cleanFrom = String(fromAddress || '').trim().toLowerCase();
  const combinedText = `${subject}\n${bodyText}`;

  // 1. Spam Complaint check
  if (isComplaint) {
    const enrollment = threadId ? await Enrollment.findOne({ threadId }) : null;
    const contact = enrollment
      ? await Contact.findById(enrollment.contactId)
      : (failedRecipientEmail ? await Contact.findOne({ email: normalizeEmail(failedRecipientEmail) }) : null);

    if (contact) {
      await addSuppression({
        email: contact.email,
        reason: 'complaint',
        notes: `Spam complaint received: ${subject}`
      });
    }

    const event = await Event.create({
      userId: mailbox.userId,
      type: 'complaint',
      enrollmentId: enrollment?._id || null,
      campaignId: enrollment?.campaignId || null,
      contactId: contact?._id || null,
      mailboxId: mailbox._id,
      fromAddress: cleanFrom,
      subject,
      snippet: bodyText.slice(0, 280),
      threadId,
      gmailMessageId
    });

    const breaker = await evaluateMailboxCircuitBreaker(mailbox._id);
    return { type: 'complaint', event, circuitBreaker: breaker };
  }

  // 2. Bounce check (messages from mailer-daemon or postmaster)
  const isBounceSender = BOUNCE_SENDER_PATTERNS.some((rx) => rx.test(cleanFrom) || rx.test(subject));
  if (isBounceSender || failedRecipientEmail) {
    // Parse failed email address from body or explicit parameter
    let bouncedEmail = failedRecipientEmail ? normalizeEmail(failedRecipientEmail) : null;
    if (!bouncedEmail) {
      const emailMatches = bodyText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g) || [];
      bouncedEmail = emailMatches
        .map(normalizeEmail)
        .find((e) => e !== mailbox.address && !BOUNCE_SENDER_PATTERNS.some((rx) => rx.test(e))) || null;
    }

    let enrollment = threadId ? await Enrollment.findOne({ threadId }) : null;
    let contact = bouncedEmail ? await Contact.findOne({ email: bouncedEmail }) : null;

    if (!contact && enrollment) {
      contact = await Contact.findById(enrollment.contactId);
      bouncedEmail = contact?.email || null;
    }
    if (!enrollment && contact) {
      enrollment = await Enrollment.findOne({ contactId: contact._id }).sort({ updatedAt: -1 });
    }

    if (bouncedEmail) {
      await addSuppression({
        email: bouncedEmail,
        reason: 'bounce',
        notes: `Bounce detected from ${cleanFrom}: ${subject}`
      });
    }

    if (enrollment) {
      enrollment.status = 'bounced';
      await enrollment.save();
    }

    const event = await Event.create({
      userId: mailbox.userId,
      type: 'bounce',
      enrollmentId: enrollment?._id || null,
      campaignId: enrollment?.campaignId || null,
      contactId: contact?._id || null,
      mailboxId: mailbox._id,
      fromAddress: cleanFrom || 'mailer-daemon@googlemail.com',
      subject: subject || 'Delivery Status Notification (Failure)',
      snippet: bodyText.slice(0, 280),
      threadId,
      gmailMessageId,
      rawPayloadSummary: { bouncedEmail }
    });

    const breaker = await evaluateMailboxCircuitBreaker(mailbox._id);
    return { type: 'bounce', bouncedEmail, event, circuitBreaker: breaker };
  }

  // Find matching enrollment by threadId or sender email
  let enrollment = threadId ? await Enrollment.findOne({ threadId }) : null;
  let contact = null;
  if (enrollment) {
    contact = await Contact.findById(enrollment.contactId);
  } else if (cleanFrom) {
    const emailMatch = cleanFrom.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    const extractedEmail = emailMatch ? normalizeEmail(emailMatch[1]) : normalizeEmail(cleanFrom);
    contact = await Contact.findOne({ email: extractedEmail });
    if (contact) {
      enrollment = await Enrollment.findOne({ contactId: contact._id }).sort({ updatedAt: -1 });
    }
  }

  if (!enrollment && !contact) {
    return { ignored: true, reason: 'unknown_thread_and_sender' };
  }

  // 3. Auto-reply / Out-of-Office detection (Section 8)
  const autoSubmittedHeader = String(headers['auto-submitted'] || headers['Auto-Submitted'] || '').toLowerCase();
  const isAutoReplyHeader = autoSubmittedHeader && autoSubmittedHeader !== 'no';
  const isAutoReplySubject = AUTO_REPLY_SUBJECT_PATTERNS.some((rx) => rx.test(subject));

  if (isAutoReplyHeader || isAutoReplySubject) {
    // Delay the next step by 3 days instead of cancelling it
    if (enrollment && enrollment.status === 'active') {
      const delayed = new Date(Math.max(Date.now(), new Date(enrollment.nextSendAt).getTime()) + 3 * 24 * 60 * 60 * 1000);
      enrollment.nextSendAt = delayed;
      await enrollment.save();
    }

    const event = await Event.create({
      userId: mailbox.userId,
      type: 'auto_reply',
      enrollmentId: enrollment?._id || null,
      campaignId: enrollment?.campaignId || null,
      contactId: contact?._id || null,
      mailboxId: mailbox._id,
      fromAddress: cleanFrom || contact?.email || '',
      subject,
      snippet: bodyText.slice(0, 280),
      threadId,
      gmailMessageId
    });

    return { type: 'auto_reply', delayedUntil: enrollment?.nextSendAt, event };
  }

  // 4. Genuine Reply from prospect (Section 8)
  const lowerCombined = combinedText.toLowerCase();
  const optOutFlagged = OPT_OUT_KEYWORDS.some((kw) => lowerCombined.includes(kw));

  if (enrollment) {
    enrollment.status = 'replied';
    await enrollment.save();
  }

  if (contact) {
    // Replies containing opt-out language pause the contact until reviewed (or one-click suppressed)
    contact.status = optOutFlagged ? 'paused' : 'replied';
    await contact.save();
  }

  const event = await Event.create({
    userId: mailbox.userId,
    type: 'reply',
    enrollmentId: enrollment?._id || null,
    campaignId: enrollment?.campaignId || null,
    contactId: contact?._id || null,
    mailboxId: mailbox._id,
    fromAddress: cleanFrom || contact?.email || '',
    subject,
    snippet: bodyText.slice(0, 500),
    threadId: threadId || enrollment?.threadId || null,
    gmailMessageId,
    optOutFlagged,
    interestedStatus: optOutFlagged ? 'not_interested' : 'unreviewed'
  });

  return {
    type: 'reply',
    optOutFlagged,
    event
  };
}

/**
 * Polls all active/warming mailboxes via Gmail API (`in:inbox newer_than:2d`)
 * for new replies and bounces (Section 8).
 */
export async function pollAllMailboxesForRepliesAndBounces() {
  const mailboxes = await Mailbox.find({
    status: { $in: ['active', 'warming'] },
    authMode: { $ne: 'mock' }
  }).select('+encryptedCredentials');

  const results = [];

  for (const mailbox of mailboxes) {
    try {
      const gmail = await getGmailClientForMailbox(mailbox);
      if (!gmail) continue;

      const listRes = await gmail.users.messages.list({
        userId: 'me',
        q: 'in:inbox newer_than:2d',
        maxResults: 50
      });

      const messages = listRes.data.messages || [];
      for (const msgSummary of messages) {
        const alreadyProcessed = await Event.findOne({ gmailMessageId: msgSummary.id }).lean();
        if (alreadyProcessed) continue;

        const msgDetail = await gmail.users.messages.get({
          userId: 'me',
          id: msgSummary.id,
          format: 'full'
        });

        const payload = msgDetail.data.payload || {};
        const headerList = payload.headers || [];
        const headersMap = {};
        for (const h of headerList) {
          headersMap[h.name.toLowerCase()] = h.value;
        }

        const fromAddress = headersMap['from'] || '';
        // Skip messages sent by the mailbox itself
        if (fromAddress.toLowerCase().includes(mailbox.address.toLowerCase())) {
          continue;
        }

        const subject = headersMap['subject'] || '';
        const snippet = msgDetail.data.snippet || '';

        const outcome = await processIncomingMessage({
          mailboxId: mailbox._id,
          threadId: msgDetail.data.threadId,
          gmailMessageId: msgSummary.id,
          fromAddress,
          subject,
          bodyText: snippet,
          headers: headersMap
        });

        results.push({ mailbox: mailbox.address, messageId: msgSummary.id, outcome });
      }
    } catch (err) {
      results.push({ mailbox: mailbox.address, error: err.message });
    }
  }

  return results;
}
