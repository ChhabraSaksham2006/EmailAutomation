import { Router } from 'express';
import { normalizeEmail } from '@cold-outreach/shared';
import {
  Mailbox,
  Contact,
  Enrollment,
  SendLog,
  Event
} from '../models/index.js';
import { addSuppression } from '../services/suppressionService.js';
import { processIncomingMessage } from '../services/sendingEngineService.js';

const router = Router();

/**
 * Optional shared secret check if BREVO_WEBHOOK_SECRET is configured in .env
 */
function verifyBrevoSecret(req) {
  const configuredSecret = process.env.BREVO_WEBHOOK_SECRET;
  if (!configuredSecret) return true;

  const querySecret = req.query.secret || req.headers['x-brevo-secret'];
  const authHeader = req.headers.authorization || '';
  const bearerSecret = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  return querySecret === configuredSecret || bearerSecret === configuredSecret;
}

/**
 * Helper to resolve Mailbox and Enrollment from a Brevo webhook payload.
 */
async function resolveContextFromBrevoWebhook(payload = {}) {
  const messageId = payload['message-id'] || payload.messageId || payload.MessageId || null;
  const recipientEmail = normalizeEmail(payload.email || payload.recipient || '');

  let customMeta = {};
  if (payload['X-Mailin-custom']) {
    try {
      customMeta = typeof payload['X-Mailin-custom'] === 'string'
        ? JSON.parse(payload['X-Mailin-custom'])
        : payload['X-Mailin-custom'];
    } catch {
      customMeta = {};
    }
  }

  let enrollment = null;
  let mailbox = null;

  if (customMeta.enrollmentId) {
    enrollment = await Enrollment.findById(customMeta.enrollmentId);
  }
  if (!enrollment && messageId) {
    const log = await SendLog.findOne({
      $or: [{ gmailMessageId: messageId }, { rfc822MessageId: messageId }]
    }).lean();
    if (log) {
      enrollment = await Enrollment.findById(log.enrollmentId);
    }
  }
  if (!enrollment && recipientEmail) {
    const contact = await Contact.findOne({ email: recipientEmail }).lean();
    if (contact) {
      enrollment = await Enrollment.findOne({ contactId: contact._id }).sort({ updatedAt: -1 });
    }
  }

  if (enrollment?.mailboxId) {
    mailbox = await Mailbox.findById(enrollment.mailboxId);
  }
  if (!mailbox && payload.sender) {
    mailbox = await Mailbox.findOne({ address: normalizeEmail(payload.sender) });
  }
  if (!mailbox) {
    mailbox = await Mailbox.findOne().sort({ createdAt: 1 });
  }

  return { enrollment, mailbox, recipientEmail, messageId };
}

/**
 * POST /webhooks/brevo
 * Handles both:
 * 1. Brevo Transactional Email Webhooks (hard_bounce, soft_bounce, blocked, invalid_email, spam, unsubscribed)
 * 2. Brevo Inbound Parsing Webhooks (items array of incoming replies)
 */
router.post('/brevo', async (req, res) => {
  try {
    if (!verifyBrevoSecret(req)) {
      return res.status(401).json({ error: 'Invalid Brevo webhook secret' });
    }

    const body = req.body || {};

    // Case 1: Brevo Inbound Parsing Webhook (`{ items: [ ... ] }`)
    if (Array.isArray(body.items) && body.items.length > 0) {
      const results = [];
      for (const item of body.items) {
        const fromAddress = item.From?.Address || item.from || '';
        const toAddress = item.To?.[0]?.Address || item.to || '';
        const subject = item.Subject || item.subject || '';
        const rawText = item.RawTextBody || item.ExtractedMarkdownMessage || item.text || '';
        const inReplyTo = item.InReplyTo || item.Headers?.['In-Reply-To'] || null;
        const msgId = item.MessageId || item.Headers?.['Message-ID'] || null;

        let mailbox = toAddress
          ? await Mailbox.findOne({ address: normalizeEmail(toAddress) })
          : null;
        if (!mailbox) {
          mailbox = await Mailbox.findOne().sort({ createdAt: 1 });
        }

        if (mailbox) {
          const outcome = await processIncomingMessage({
            mailboxId: mailbox._id,
            threadId: inReplyTo,
            gmailMessageId: msgId,
            fromAddress,
            subject,
            bodyText: rawText,
            headers: item.Headers || {}
          });
          results.push(outcome);
        }
      }
      return res.status(200).json({ processed: true, mode: 'brevo_inbound', results });
    }

    // Case 2: Brevo Transactional Event Webhook
    const eventType = String(body.event || '').toLowerCase();
    const { enrollment, mailbox, recipientEmail, messageId } = await resolveContextFromBrevoWebhook(body);

    if (!eventType) {
      return res.status(200).json({ ignored: true, reason: 'missing_event_type' });
    }

    // Hard Bounce / Invalid Email / Blocked
    if (['hard_bounce', 'invalid_email', 'blocked', 'error'].includes(eventType)) {
      if (mailbox && recipientEmail) {
        const outcome = await processIncomingMessage({
          mailboxId: mailbox._id,
          threadId: enrollment?.threadId || messageId,
          gmailMessageId: `brevo_evt_${eventType}_${messageId || Date.now()}`,
          fromAddress: 'mailer-daemon@brevo.com',
          subject: `Brevo ${eventType}: ${recipientEmail}`,
          bodyText: body.reason || `Brevo reported ${eventType} for ${recipientEmail}`,
          failedRecipientEmail: recipientEmail
        });
        return res.status(200).json({ processed: true, eventType, outcome });
      }
    }

    // Spam Complaint (0 tolerance -> immediate mailbox pause via circuit breaker)
    if (['spam', 'complaint'].includes(eventType)) {
      if (mailbox) {
        const outcome = await processIncomingMessage({
          mailboxId: mailbox._id,
          threadId: enrollment?.threadId || messageId,
          gmailMessageId: `brevo_evt_${eventType}_${messageId || Date.now()}`,
          fromAddress: recipientEmail || 'complaint@brevo.com',
          subject: `Brevo Spam Complaint: ${recipientEmail}`,
          bodyText: body.reason || `Recipient ${recipientEmail} marked email as spam in Brevo.`,
          failedRecipientEmail: recipientEmail,
          isComplaint: true
        });
        return res.status(200).json({ processed: true, eventType, outcome });
      }
    }

    // Unsubscribed event from Brevo
    if (eventType === 'unsubscribed' && recipientEmail) {
      const suppression = await addSuppression({
        email: recipientEmail,
        reason: 'opt_out',
        notes: 'Unsubscribed via Brevo webhook event'
      });
      await Event.create({
        userId: mailbox?.userId || null,
        type: 'opt_out',
        enrollmentId: enrollment?._id || null,
        campaignId: enrollment?.campaignId || null,
        mailboxId: mailbox?._id || null,
        fromAddress: recipientEmail,
        subject: 'Brevo Unsubscribe Event',
        snippet: `${recipientEmail} unsubscribed via Brevo.`
      });
      return res.status(200).json({ processed: true, eventType, suppression });
    }

    return res.status(200).json({ received: true, eventType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
