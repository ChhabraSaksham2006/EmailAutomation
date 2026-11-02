import { Router } from 'express';
import {
  DEFAULT_CLEARED_COUNTRIES,
  RESTRICTED_REGIONS_INFO,
  LAWFUL_BASIS_OPTIONS,
  ALLOWED_CONTACT_SOURCES,
  HARD_LIMITS
} from '@cold-outreach/shared';
import { ComplianceConfig } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// GET /compliance
router.get('/', async (req, res) => {
  try {
    const defaultAddress = process.env.SENDER_POSTAL_ADDRESS || 'Nehru Park, SCO 1, S D Market Model Town, Yamuna Nagar, Haryana 135001';
    const defaultAlert = process.env.ALERT_EMAIL || 'info@ramaconsultants.com';

    let config = await ComplianceConfig.findOne({ userId: req.user._id });
    if (!config) {
      config = await ComplianceConfig.create({
        userId: req.user._id,
        clearedCountries: [...DEFAULT_CLEARED_COUNTRIES],
        senderPostalAddress: defaultAddress,
        defaultSenderCompany: 'Rama Consultants',
        alertEmail: defaultAlert
      });
    } else if (
      config.senderPostalAddress === '123 Market St, Suite 400, San Francisco, CA 94105, USA' ||
      !config.senderPostalAddress
    ) {
      config.senderPostalAddress = defaultAddress;
      config.alertEmail = defaultAlert;
      await config.save();
    }

    res.json({
      config,
      reference: {
        restrictedRegions: RESTRICTED_REGIONS_INFO,
        lawfulBasisOptions: LAWFUL_BASIS_OPTIONS,
        allowedContactSources: ALLOWED_CONTACT_SOURCES,
        hardLimits: HARD_LIMITS
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /compliance
router.put('/', async (req, res) => {
  try {
    let config = await ComplianceConfig.findOne({ userId: req.user._id });
    if (!config) {
      config = new ComplianceConfig({ userId: req.user._id });
    }

    if (Array.isArray(req.body.clearedCountries)) {
      config.clearedCountries = req.body.clearedCountries
        .map((c) => String(c).trim().toUpperCase())
        .filter(Boolean);
    }
    if (req.body.senderPostalAddress !== undefined) {
      config.senderPostalAddress = String(req.body.senderPostalAddress).trim();
    }
    if (req.body.defaultSenderCompany !== undefined) {
      config.defaultSenderCompany = String(req.body.defaultSenderCompany).trim();
    }
    if (req.body.alertEmail !== undefined) {
      config.alertEmail = String(req.body.alertEmail).trim();
    }

    await config.save();
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
