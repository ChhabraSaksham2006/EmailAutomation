import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import {
  HARD_LIMITS,
  normalizeEmail
} from '@cold-outreach/shared';
import { Contact } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  isEmailSuppressed,
  addSuppression,
  gdprDeleteContact
} from '../services/suppressionService.js';
import { verifySingleEmail } from '../services/verificationService.js';

const router = Router();

export const TEMPLATE_COLUMNS_SPEC = [
  {
    column: 'email',
    required: true,
    variable: '{{email}}',
    description: 'Prospect work email address (checked against global suppression list & email verifier).',
    example: 'sarah.chen@linearflow.io'
  },
  {
    column: 'first_name',
    required: false,
    variable: '{{first_name}}',
    description: 'Prospect first name. Use {{default first_name "there"}} in templates for automatic fallback.',
    example: 'Sarah'
  },
  {
    column: 'company',
    required: false,
    variable: '{{company}}',
    description: 'Prospect company or organization name.',
    example: 'LinearFlow'
  },
  {
    column: 'title',
    required: false,
    variable: '{{title}}',
    description: 'Prospect job title or role.',
    example: 'VP of Engineering'
  },
  {
    column: 'country',
    required: false,
    variable: '{{country}}',
    description: '2-letter ISO country code (e.g. US, IN, GB, CA, DE). Checked against your cleared regions.',
    example: 'US'
  },
  {
    column: 'timezone',
    required: false,
    variable: 'N/A (Scheduling)',
    description: 'IANA timezone so emails only send during 9:00–11:00 AM in the prospect local time.',
    example: 'America/New_York'
  },
  {
    column: 'source',
    required: false,
    variable: 'N/A (Compliance)',
    description: 'How the contact was sourced (manual_research, linkedin_hand_curated, company_website, conference_attendee).',
    example: 'manual_research'
  },
  {
    column: 'source_note',
    required: false,
    variable: 'N/A (Compliance)',
    description: 'Why this prospect is relevant to your offer (lawful-basis audit record).',
    example: 'Scaling engineering team; active CI/CD blog author'
  },
  {
    column: 'lawful_basis',
    required: false,
    variable: 'N/A (Compliance)',
    description: 'Lawful basis for outreach (legitimate_interest_b2b, public_corporate_contact_b2b, explicit_consent).',
    example: 'legitimate_interest_b2b'
  },
  {
    column: 'target_role_plural',
    required: false,
    variable: '{{target_role_plural}}',
    description: 'Custom variable used in the starter sequence (e.g. "engineering leaders", "finance teams").',
    example: 'VP Engineering leaders'
  },
  {
    column: 'one_line_value',
    required: false,
    variable: '{{one_line_value}}',
    description: 'Custom variable describing your 1-sentence value prop for this prospect segment.',
    example: 'cutting deployment queue times in half'
  },
  {
    column: 'follow_up_angle',
    required: false,
    variable: '{{follow_up_angle}}',
    description: 'Custom variable for Step 2 follow-up angle.',
    example: 'Happy to share a short 2-sentence case study on how similar teams set this up.'
  },
  {
    column: 'topic',
    required: false,
    variable: '{{topic}}',
    description: 'Custom variable for Step 3 break-up note topic.',
    example: 'CI pipeline velocity'
  }
];

export const TEMPLATE_SAMPLE_ROWS = [
  {
    email: 'sarah.chen@linearflow.io',
    first_name: 'Sarah',
    company: 'LinearFlow',
    title: 'VP of Engineering',
    country: 'US',
    timezone: 'America/New_York',
    source: 'manual_research',
    source_note: 'Published engineering post on CI bottlenecks',
    lawful_basis: 'legitimate_interest_b2b',
    target_role_plural: 'VP Engineering leaders',
    one_line_value: 'eliminating flaky deployment bottlenecks',
    follow_up_angle: 'Happy to share a short 2-sentence example of how similar teams approach this.',
    topic: 'CI pipeline speed'
  },
  {
    email: 'marcus.vance@cloudscale.io',
    first_name: 'Marcus',
    company: 'CloudScale',
    title: 'Head of Operations',
    country: 'US',
    timezone: 'America/Chicago',
    source: 'linkedin_hand_curated',
    source_note: 'Hiring operations leads in Austin',
    lawful_basis: 'legitimate_interest_b2b',
    target_role_plural: 'B2B operations leaders',
    one_line_value: 'automating client onboarding workflows',
    follow_up_angle: 'Can send over a 1-page checklist we used with a similar Austin team.',
    topic: 'client onboarding automation'
  },
  {
    email: 'arjun.mehta@fincrest.in',
    first_name: 'Arjun',
    company: 'FinCrest',
    title: 'Founder & CEO',
    country: 'US',
    timezone: 'Asia/Kolkata',
    source: 'company_website',
    source_note: 'Recent milestone announcement on company news page',
    lawful_basis: 'legitimate_interest_b2b',
    target_role_plural: 'fintech founders',
    one_line_value: 'streamlining regulatory audit readiness',
    follow_up_angle: 'Happy to share how other fintech teams structure their quarterly compliance checks.',
    topic: 'audit readiness'
  }
];

function buildCsvTemplateString() {
  const headers = TEMPLATE_COLUMNS_SPEC.map((c) => c.column);
  const escapeCsv = (val) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(',')];
  for (const row of TEMPLATE_SAMPLE_ROWS) {
    lines.push(headers.map((h) => escapeCsv(row[h] ?? '')).join(','));
  }
  return lines.join('\r\n');
}

// Public / Authenticated template download routes
router.get('/template/csv', (_req, res) => {
  const csvContent = buildCsvTemplateString();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="outreach_contacts_template.csv"');
  res.send(csvContent);
});

router.get('/template/xlsx', (_req, res) => {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Contacts_Import with sample rows
  const contactsSheet = XLSX.utils.json_to_sheet(TEMPLATE_SAMPLE_ROWS);
  contactsSheet['!cols'] = [
    { wch: 28 }, // email
    { wch: 14 }, // first_name
    { wch: 18 }, // company
    { wch: 20 }, // title
    { wch: 10 }, // country
    { wch: 20 }, // timezone
    { wch: 65 }, // custom_opener
    { wch: 22 }, // source
    { wch: 35 }, // source_note
    { wch: 25 }, // lawful_basis
    { wch: 24 }, // target_role_plural
    { wch: 36 }, // one_line_value
    { wch: 45 }, // follow_up_angle
    { wch: 24 }  // topic
  ];
  XLSX.utils.book_append_sheet(wb, contactsSheet, 'Contacts_Import');

  // Sheet 2: Column Guide & Instructions
  const guideRows = TEMPLATE_COLUMNS_SPEC.map((c) => ({
    'Column Header': c.column,
    'Required?': c.required ? 'REQUIRED' : 'Optional / Recommended',
    'Template Variable': c.variable,
    'How to Use / Instructions': c.description,
    'Example Value': c.example
  }));
  guideRows.push({
    'Column Header': '<any_custom_column>',
    'Required?': 'Optional (Custom)',
    'Template Variable': '{{any_custom_column}}',
    'How to Use / Instructions': 'You can add any extra column to your Excel/CSV sheet and reference it in your email sequence as {{column_name}}.',
    'Example Value': 'Custom value for that prospect'
  });

  const guideSheet = XLSX.utils.json_to_sheet(guideRows);
  guideSheet['!cols'] = [
    { wch: 24 },
    { wch: 22 },
    { wch: 24 },
    { wch: 75 },
    { wch: 50 }
  ];
  XLSX.utils.book_append_sheet(wb, guideSheet, 'Column_Instructions');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="outreach_contacts_template.xlsx"'
  );
  res.send(buffer);
});

router.use(requireAuth);

router.get('/template-info', (_req, res) => {
  res.json({
    columns: TEMPLATE_COLUMNS_SPEC,
    sampleRows: TEMPLATE_SAMPLE_ROWS
  });
});

// Multer config with 5MB upload limit supporting both CSV and Excel (.xlsx / .xls)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
      'text/plain',
      'application/csv'
    ];
    const name = file.originalname?.toLowerCase() || '';
    const isAllowedExt = name.endsWith('.csv') || name.endsWith('.xlsx') || name.endsWith('.xls');
    if (allowedMimes.includes(file.mimetype) || isAllowedExt) {
      cb(null, true);
    } else {
      cb(new Error('Only .csv, .xlsx, and .xls files are allowed'));
    }
  }
});

// GET /contacts
router.get('/', async (req, res) => {
  try {
    const query = { userId: req.user._id };
    if (req.query.status) query.status = req.query.status;
    if (req.query.verificationStatus) query.verificationStatus = req.query.verificationStatus;
    if (req.query.country) query.country = String(req.query.country).toUpperCase();
    if (req.query.search) {
      const rx = new RegExp(String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ email: rx }, { firstName: rx }, { company: rx }];
    }

    const contacts = await Contact.find(query).sort({ createdAt: -1 }).limit(1000);
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /contacts/import (Supports .xlsx, .xls, .csv file upload, csvText, or JSON rows)
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const confirmSourcing =
      req.body.confirmNotPurchasedOrScraped === true ||
      req.body.confirmNotPurchasedOrScraped === 'true';

    if (!confirmSourcing) {
      return res.status(400).json({
        error: 'Compliance violation: You must confirm that this list was hand-researched or legitimately sourced and is NOT a purchased or bulk-scraped list (Section 10).'
      });
    }

    let rawRows = [];
    if (req.file) {
      const filename = (req.file.originalname || '').toLowerCase();
      const isExcel =
        filename.endsWith('.xlsx') ||
        filename.endsWith('.xls') ||
        req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

      if (isExcel) {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          return res.status(400).json({ error: 'The uploaded Excel workbook contains no sheets.' });
        }
        const worksheet = workbook.Sheets[firstSheetName];
        rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
      } else {
        const csvString = req.file.buffer.toString('utf8');
        rawRows = parse(csvString, {
          columns: true,
          skip_empty_lines: true,
          trim: true
        });
      }
    } else if (Array.isArray(req.body.rows)) {
      rawRows = req.body.rows;
    } else if (typeof req.body.csvText === 'string' && req.body.csvText.trim()) {
      rawRows = parse(req.body.csvText, {
        columns: true,
        skip_empty_lines: true,
        trim: true
      });
    } else {
      return res.status(400).json({ error: 'Upload a .csv or .xlsx/.xls file, or provide rows to import.' });
    }

    if (rawRows.length > HARD_LIMITS.MAX_CSV_ROWS) {
      return res.status(400).json({
        error: `Import exceeds maximum row cap of ${HARD_LIMITS.MAX_CSV_ROWS} contacts per batch.`
      });
    }

    let mapping = {};
    if (req.body.columnMapping) {
      mapping = typeof req.body.columnMapping === 'string'
        ? JSON.parse(req.body.columnMapping)
        : req.body.columnMapping;
    }

    const defaultSource = String(req.body.defaultSource || 'manual_research').trim();
    const defaultSourceNote = String(req.body.defaultSourceNote || '').trim();
    const defaultLawfulBasis = String(req.body.defaultLawfulBasis || 'legitimate_interest_b2b').trim();

    const imported = [];
    const updated = [];
    const skippedSuppressed = [];
    const skippedInvalid = [];

    const pickField = (row, fieldKey, fallbackKeys = []) => {
      const mappedCol = mapping[fieldKey];
      if (mappedCol && row[mappedCol] !== undefined) return row[mappedCol];
      if (row[fieldKey] !== undefined) return row[fieldKey];
      for (const k of fallbackKeys) {
        if (row[k] !== undefined) return row[k];
      }
      return '';
    };

    const reservedCols = new Set([
      'email', 'firstName', 'first_name', 'company', 'title',
      'timezone', 'country', 'source', 'sourceNote', 'source_note',
      'lawfulBasis', 'lawful_basis', 'regionOverride', 'region_override'
    ]);

    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      const email = normalizeEmail(pickField(row, 'email', ['Email', 'EMAIL', 'email_address', 'Work Email']));
      if (!email || !email.includes('@')) {
        skippedInvalid.push({ rowIndex: i, email: email || '(empty)', reason: 'missing_or_invalid_email' });
        continue;
      }

      // Check global suppression list at import time (Section 10)
      const supCheck = await isEmailSuppressed(email);
      if (supCheck.suppressed) {
        skippedSuppressed.push({
          rowIndex: i,
          email,
          reason: `Suppressed (${supCheck.reason})`
        });
        continue;
      }

      const firstName = String(pickField(row, 'firstName', ['first_name', 'First Name', 'firstname', 'Name'])).trim();
      const company = String(pickField(row, 'company', ['Company', 'company_name', 'organization', 'Organization'])).trim();
      const title = String(pickField(row, 'title', ['Title', 'job_title', 'role', 'Job Title'])).trim();
      const timezone = String(pickField(row, 'timezone', ['Timezone', 'tz', 'Time Zone']) || 'America/New_York').trim();
      const country = String(pickField(row, 'country', ['Country', 'COUNTRY', 'region']) || 'US').trim().toUpperCase();
      const customOpener = String(pickField(row, 'custom_opener', ['customOpener', 'Custom Opener', 'opener', 'personalization'])).trim();
      const source = String(pickField(row, 'source', ['Source']) || defaultSource).trim();
      const sourceNote = String(pickField(row, 'sourceNote', ['source_note', 'relevance', 'why_relevant', 'Source Note']) || defaultSourceNote).trim();
      const lawfulBasis = String(pickField(row, 'lawfulBasis', ['lawful_basis', 'Lawful Basis']) || defaultLawfulBasis).trim();
      const regionOverrideRaw = pickField(row, 'regionOverride', ['region_override']);
      const regionOverride = regionOverrideRaw === true || String(regionOverrideRaw).toLowerCase() === 'true';

      // Collect additional template variables from any remaining columns
      const extraVars = {};
      for (const [colKey, colVal] of Object.entries(row)) {
        const cleanKey = colKey.trim().replace(/\s+/g, '_').toLowerCase();
        if (!reservedCols.has(colKey) && !reservedCols.has(cleanKey) && colVal !== undefined) {
          extraVars[cleanKey] = String(colVal).trim();
        }
      }
      if (row.variables && typeof row.variables === 'object') {
        Object.assign(extraVars, row.variables);
      }
      extraVars.custom_opener = customOpener || extraVars.custom_opener || '';

      const existing = await Contact.findOne({ email });
      if (existing) {
        existing.firstName = firstName || existing.firstName;
        existing.company = company || existing.company;
        existing.title = title || existing.title;
        existing.timezone = timezone || existing.timezone;
        existing.country = country || existing.country;
        existing.source = source || existing.source;
        existing.sourceNote = sourceNote || existing.sourceNote;
        existing.lawfulBasis = lawfulBasis || existing.lawfulBasis;
        if (regionOverride) existing.regionOverride = true;
        existing.variables = {
          ...(existing.variables || {}),
          ...extraVars
        };
        await existing.save();
        updated.push(existing);
      } else {
        const created = await Contact.create({
          userId: req.user._id,
          email,
          firstName,
          company,
          title,
          timezone,
          country,
          source,
          sourceNote,
          lawfulBasis,
          regionOverride,
          variables: extraVars,
          verificationStatus: 'unverified',
          status: 'active'
        });
        imported.push(created);
      }
    }

    res.status(201).json({
      summary: {
        totalRows: rawRows.length,
        importedCount: imported.length,
        updatedCount: updated.length,
        skippedSuppressedCount: skippedSuppressed.length,
        skippedInvalidCount: skippedInvalid.length
      },
      imported,
      updated,
      skippedSuppressed,
      skippedInvalid
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /contacts/verify
router.post('/verify', async (req, res) => {
  try {
    const query = { userId: req.user._id };
    if (Array.isArray(req.body.contactIds) && req.body.contactIds.length > 0) {
      query._id = { $in: req.body.contactIds };
    } else if (!req.body.verifyAll) {
      query.verificationStatus = 'unverified';
    }

    const contacts = await Contact.find(query);
    const results = {
      valid: 0,
      risky: 0,
      invalid: 0,
      details: []
    };

    for (const contact of contacts) {
      const check = await verifySingleEmail(contact.email);
      contact.verificationStatus = check.status;

      if (check.status === 'invalid') {
        contact.status = 'bounced';
        await addSuppression({
          email: contact.email,
          reason: 'bounce',
          notes: `Invalid email detected during verification (${check.reason})`
        });
      }

      await contact.save();
      results[check.status] = (results[check.status] || 0) + 1;
      results.details.push({
        contactId: contact._id,
        email: contact.email,
        verificationStatus: check.status,
        reason: check.reason
      });
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /contacts/:id
router.put('/:id', async (req, res) => {
  try {
    const contact = await Contact.findOne({ _id: req.params.id, userId: req.user._id });
    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const fields = ['firstName', 'company', 'title', 'timezone', 'source', 'sourceNote', 'lawfulBasis', 'regionOverrideReason'];
    for (const f of fields) {
      if (req.body[f] !== undefined) contact[f] = String(req.body[f]).trim();
    }
    if (req.body.country !== undefined) contact.country = String(req.body.country).trim().toUpperCase();
    if (req.body.regionOverride !== undefined) contact.regionOverride = Boolean(req.body.regionOverride);
    if (req.body.verificationStatus && ['valid', 'risky', 'invalid', 'unverified'].includes(req.body.verificationStatus)) {
      contact.verificationStatus = req.body.verificationStatus;
    }
    if (req.body.status && ['active', 'replied', 'bounced', 'opted_out', 'paused'].includes(req.body.status)) {
      contact.status = req.body.status;
    }
    if (req.body.variables && typeof req.body.variables === 'object') {
      contact.variables = {
        ...(contact.variables || {}),
        ...req.body.variables
      };
      contact.markModified('variables');
    }
    if (req.body.custom_opener !== undefined) {
      contact.variables = {
        ...(contact.variables || {}),
        custom_opener: String(req.body.custom_opener).trim()
      };
      contact.markModified('variables');
    }

    await contact.save();
    res.json({ contact });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /contacts/:id/gdpr-delete (Section 10: Deletion on request, keeping only SHA-256 hash in Suppression)
router.post('/:id/gdpr-delete', async (req, res) => {
  try {
    const result = await gdprDeleteContact(req.params.id, req.user._id);
    res.json(result);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

export default router;
