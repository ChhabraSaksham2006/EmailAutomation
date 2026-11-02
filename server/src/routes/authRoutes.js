import { Router } from 'express';
import bcrypt from 'bcryptjs';
import {
  normalizeEmail,
  STARTER_PLAYBOOK_SEQUENCE,
  DEFAULT_CLEARED_COUNTRIES
} from '@cold-outreach/shared';
import { User, Sequence, ComplianceConfig } from '../models/index.js';
import { signAuthToken, requireAuth } from '../middleware/auth.js';
import { syncEnvMailboxesForUser } from '../services/gmailService.js';

const router = Router();

// Check if initial admin registration is open
router.get('/status', async (_req, res) => {
  try {
    const count = await User.countDocuments();
    res.json({ registrationOpen: count === 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/register (disabled after the first admin is created - Section 6)
router.post('/register', async (req, res) => {
  try {
    const existingUsers = await User.countDocuments();
    if (existingUsers > 0) {
      return res.status(403).json({
        error: 'Registration is disabled after the first admin account has been created.'
      });
    }

    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const name = String(req.body.name || 'Admin Operator').trim();

    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email address is required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      email,
      passwordHash,
      name,
      role: 'admin'
    });

    // Seed default ComplianceConfig & Starter 3-Step Sequence Playbook (Section 11)
    await ComplianceConfig.create({
      userId: user._id,
      clearedCountries: [...DEFAULT_CLEARED_COUNTRIES],
      senderPostalAddress: process.env.SENDER_POSTAL_ADDRESS || 'Nehru Park, SCO 1, S D Market Model Town, Yamuna Nagar, Haryana 135001',
      defaultSenderCompany: 'Rama Consultants',
      alertEmail: process.env.ALERT_EMAIL || 'info@ramaconsultants.com'
    });

    await Sequence.create({
      userId: user._id,
      ...STARTER_PLAYBOOK_SEQUENCE
    });

    await syncEnvMailboxesForUser(user._id);

    const token = signAuthToken(user);
    res.status(201).json({
      token,
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = signAuthToken(user);
    res.json({
      token,
      user: {
        _id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user });
});

export default router;
