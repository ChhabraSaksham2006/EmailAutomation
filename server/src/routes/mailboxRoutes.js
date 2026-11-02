import { Router } from 'express';
import { HARD_LIMITS } from '@cold-outreach/shared';
import { Mailbox, Event } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  ensureMailboxDailyReset,
  evaluateMailboxCircuitBreaker
} from '../services/circuitBreakerService.js';
import {
  checkBrevoApiConfiguration,
  syncEnvMailboxesForUser,
  getOrCreateBrevoDomain,
  authenticateBrevoDomain
} from '../services/gmailService.js';
import { reloadEnv } from '../loadEnv.js';

const router = Router();
router.use(requireAuth);

// GET /mailboxes (Auto-syncs sender mailboxes from .env and returns health & daily cap state)
router.get('/', async (req, res) => {
  try {
    reloadEnv();
    const mailboxes = await syncEnvMailboxesForUser(req.user._id);
    for (const mb of mailboxes) {
      await ensureMailboxDailyReset(mb);
    }

    const rawKey = String(process.env.BREVO_API_KEY || '').trim();
    const isKeyConfigured = Boolean(rawKey && !rawKey.startsWith('xkeysib-replace'));
    const brevoStatus = isKeyConfigured ? await checkBrevoApiConfiguration(rawKey) : null;

    res.json({
      mailboxes,
      brevoStatus,
      envConfig: {
        brevoApiKeyConfigured: isKeyConfigured,
        maskedApiKey: isKeyConfigured ? `${rawKey.slice(0, 12)}••••••••${rawKey.slice(-4)}` : null,
        brevoSenderEmail: process.env.BREVO_SENDER_EMAIL || 'info@ramaconsultants.com',
        brevoSenderName: process.env.BREVO_SENDER_NAME || 'Rama Consultants',
        senderPostalAddress: process.env.SENDER_POSTAL_ADDRESS || ''
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /mailboxes/sync-env (Re-syncs mailboxes from .env and Brevo API)
router.post('/sync-env', async (req, res) => {
  try {
    reloadEnv();
    const mailboxes = await syncEnvMailboxesForUser(req.user._id);
    const rawKey = String(process.env.BREVO_API_KEY || '').trim();
    const isKeyConfigured = Boolean(rawKey && !rawKey.startsWith('xkeysib-replace'));
    const brevoStatus = await checkBrevoApiConfiguration(rawKey);
    res.json({
      mailboxes,
      brevoStatus,
      envConfig: {
        brevoApiKeyConfigured: isKeyConfigured,
        maskedApiKey: isKeyConfigured ? `${rawKey.slice(0, 12)}••••••••${rawKey.slice(-4)}` : null,
        brevoSenderEmail: process.env.BREVO_SENDER_EMAIL || 'info@ramaconsultants.com',
        brevoSenderName: process.env.BREVO_SENDER_NAME || 'Rama Consultants',
        senderPostalAddress: process.env.SENDER_POSTAL_ADDRESS || ''
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /mailboxes/verify-brevo (Tests the .env BREVO_API_KEY and returns account credits + verified senders)
router.post('/verify-brevo', async (_req, res) => {
  try {
    const status = await checkBrevoApiConfiguration(process.env.BREVO_API_KEY);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /mailboxes/brevo-domain/dns (Uses .env BREVO_API_KEY)
router.post('/brevo-domain/dns', async (req, res) => {
  try {
    const { domain } = req.body;
    const result = await getOrCreateBrevoDomain(domain, process.env.BREVO_API_KEY);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /mailboxes/brevo-domain/authenticate (Uses .env BREVO_API_KEY)
router.post('/brevo-domain/authenticate', async (req, res) => {
  try {
    const { domain } = req.body;
    const result = await authenticateBrevoDomain(domain, process.env.BREVO_API_KEY);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /mailboxes/:id (Adjust daily cap or status; credentials/mailboxes come strictly from .env)
router.put('/:id', async (req, res) => {
  try {
    const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: req.user._id });
    if (!mailbox) {
      return res.status(404).json({ error: 'Mailbox not found' });
    }

    if (req.body.status && ['warming', 'active', 'paused'].includes(req.body.status)) {
      mailbox.status = req.body.status;
    }
    if (req.body.dailyCap !== undefined) {
      const cap = Number(req.body.dailyCap);
      if (cap < 1 || cap > HARD_LIMITS.MAX_DAILY_CAP) {
        return res.status(400).json({
          error: `Daily cap cannot exceed ${HARD_LIMITS.MAX_DAILY_CAP}.`
        });
      }
      mailbox.dailyCap = cap;
    }

    await mailbox.save();
    res.json({ mailbox });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /mailboxes/:id/pause
router.post('/:id/pause', async (req, res) => {
  try {
    const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: req.user._id });
    if (!mailbox) {
      return res.status(404).json({ error: 'Mailbox not found' });
    }

    mailbox.status = 'paused';
    mailbox.health.lastPausedReason = req.body.reason || 'Manually paused by operator';
    await mailbox.save();

    res.json({ mailbox });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /mailboxes/:id/resume
router.post('/:id/resume', async (req, res) => {
  try {
    const mailbox = await Mailbox.findOne({ _id: req.params.id, userId: req.user._id });
    if (!mailbox) {
      return res.status(404).json({ error: 'Mailbox not found' });
    }

    if (req.body.acknowledgeComplaints) {
      await Event.updateMany(
        { mailboxId: mailbox._id, type: 'complaint' },
        { $set: { type: 'error', snippet: '[Reviewed Complaint] ' } }
      );
      mailbox.health.complaintsCount = 0;
    }

    mailbox.status = req.body.status === 'warming' ? 'warming' : 'active';
    mailbox.health.lastPausedReason = '';
    await mailbox.save();

    await evaluateMailboxCircuitBreaker(mailbox._id);
    const updated = await Mailbox.findById(mailbox._id);

    res.json({ mailbox: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
