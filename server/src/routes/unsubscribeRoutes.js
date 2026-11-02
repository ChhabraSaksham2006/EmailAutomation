import { Router } from 'express';
import { verifyUnsubscribeToken } from '@cold-outreach/shared';
import { Event, Contact, Enrollment } from '../models/index.js';
import { addSuppression } from '../services/suppressionService.js';

const router = Router();

async function processUnsubscribeToken(token, sourceMethod = 'link') {
  const secret = process.env.UNSUBSCRIBE_SIGNING_SECRET || 'dev-unsubscribe-secret-key';
  const payload = verifyUnsubscribeToken(token, secret);
  if (!payload || !payload.email) {
    return { valid: false };
  }

  const suppression = await addSuppression({
    email: payload.email,
    reason: 'opt_out',
    notes: `Unsubscribed immediately via ${sourceMethod}`
  });

  const contact = await Contact.findOne({ email: payload.email });
  if (payload.enrollmentId) {
    await Enrollment.findByIdAndUpdate(payload.enrollmentId, {
      $set: { status: 'opted_out' }
    });
  }

  await Event.create({
    userId: contact?.userId || null,
    type: 'opt_out',
    enrollmentId: payload.enrollmentId || null,
    campaignId: payload.campaignId || null,
    contactId: contact?._id || null,
    fromAddress: payload.email,
    subject: 'One-Click Unsubscribe Processed',
    snippet: `${payload.email} opted out via ${sourceMethod}; added to global suppression list immediately.`
  });

  return {
    valid: true,
    email: payload.email,
    suppression
  };
}

// GET /unsubscribe/:token
// Supports JSON response (when requested by React SPA via Accept: application/json) or standalone HTML confirmation
router.get('/:token', async (req, res) => {
  try {
    const result = await processUnsubscribeToken(req.params.token, 'GET unsubscribe link');
    if (!result.valid) {
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(400).json({ error: 'Invalid or tampered unsubscribe token.' });
      }
      return res.status(400).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Invalid Unsubscribe Link</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 60px auto; padding: 24px; text-align: center;">
  <h2>Invalid Unsubscribe Link</h2>
  <p>This unsubscribe link is invalid or could not be verified.</p>
</body>
</html>`);
    }

    if (req.query.format === 'json' || (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html'))) {
      return res.json({
        unsubscribed: true,
        email: result.email,
        message: 'You have been immediately unsubscribed and added to the global suppression list.'
      });
    }

    return res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed</title>
</head>
<body style="font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 60px 16px;">
  <div style="max-width: 460px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 32px; text-align: center;">
    <div style="width: 48px; height: 48px; border-radius: 9999px; background: #dcfce7; color: #166534; display: inline-flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;">✓</div>
    <h1 style="font-size: 20px; margin: 0 0 8px;">You are unsubscribed</h1>
    <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">
      <strong>${result.email}</strong> has been immediately removed from all active sequences and added to our permanent suppression list.
    </p>
  </div>
</body>
</html>`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /unsubscribe/:token (RFC 8058 One-Click List-Unsubscribe-Post + API call)
router.post('/:token', async (req, res) => {
  try {
    const result = await processUnsubscribeToken(req.params.token, 'RFC 8058 One-Click POST');
    if (!result.valid) {
      return res.status(400).json({ error: 'Invalid or tampered unsubscribe token.' });
    }

    res.status(200).json({
      unsubscribed: true,
      email: result.email,
      message: 'One-click unsubscribe processed immediately.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
