import { Router } from 'express';
import { Suppression } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { addSuppression, isEmailSuppressed } from '../services/suppressionService.js';

const router = Router();
router.use(requireAuth);

// GET /suppression - Section 6 & 12
router.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.reason) query.reason = req.query.reason;
    if (req.query.type) query.type = req.query.type;
    if (req.query.search) {
      const rx = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.email = rx;
    }

    const entries = await Suppression.find(query).sort({ createdAt: -1 }).limit(1000).lean();
    res.json({ suppressions: entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /suppression - Add manual email or domain (@company.com) to global suppression
router.post('/', async (req, res) => {
  try {
    const { email, reason = 'manual', notes = '', isDomain = false } = req.body;
    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: 'Email or domain is required.' });
    }

    const entry = await addSuppression({
      email,
      reason: ['opt_out', 'bounce', 'complaint', 'manual'].includes(reason) ? reason : 'manual',
      notes,
      isDomain: Boolean(isDomain)
    });

    res.status(201).json({ suppression: entry });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /suppression/check - Test if an email is suppressed (Section 16 Go-Live Checklist item)
router.post('/check', async (req, res) => {
  try {
    const result = await isEmailSuppressed(req.body.email);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /suppression/:id
router.delete('/:id', async (req, res) => {
  try {
    const entry = await Suppression.findById(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: 'Suppression entry not found' });
    }
    if (entry.reason === 'gdpr_deleted') {
      return res.status(400).json({
        error: 'Hashed GDPR deletion suppression entries cannot be removed.'
      });
    }
    await Suppression.deleteOne({ _id: entry._id });
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
