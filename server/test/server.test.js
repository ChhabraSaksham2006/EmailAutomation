import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { encryptCredentials } from '@cold-outreach/shared';
import {
  buildPlainTextMime,
  buildBrevoEmailPayload,
  resolveBrevoApiKey,
  formatBrevoDomainDnsRecords,
  getOrCreateBrevoDomain
} from '../src/services/gmailService.js';
import { verifySingleEmail } from '../src/services/verificationService.js';
import {
  TEMPLATE_COLUMNS_SPEC,
  TEMPLATE_SAMPLE_ROWS
} from '../src/routes/contactRoutes.js';
import {
  Mailbox,
  Sequence,
  SendLog,
  Enrollment
} from '../src/models/index.js';

test('Excel (.xlsx) template generation and workbook parsing round-trip', () => {
  assert.ok(TEMPLATE_COLUMNS_SPEC.some((c) => c.column === 'email' && c.required));
  assert.equal(TEMPLATE_COLUMNS_SPEC.some((c) => c.column === 'custom_opener'), false);
  assert.equal(TEMPLATE_SAMPLE_ROWS.length, 3);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(TEMPLATE_SAMPLE_ROWS);
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts_Import');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  const parsedWb = XLSX.read(buf, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(parsedWb.Sheets[parsedWb.SheetNames[0]], { defval: '' });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].email, 'sarah.chen@linearflow.io');
  assert.equal(rows[0].company, 'LinearFlow');
});

test('buildBrevoEmailPayload builds Brevo v3 transactional payload with RFC 8058 and thread headers', () => {
  const { payload } = buildBrevoEmailPayload({
    fromName: 'Alex Morgan',
    fromAddress: 'alex@getbrand.com',
    toAddress: 'sarah@linearflow.io',
    toName: 'Sarah',
    subject: 'Quick question about LinearFlow',
    textBody: 'Hi Sarah,\n\nLoved your post.',
    unsubscribeHttpsUrl: 'https://api.getbrand.com/api/unsubscribe/tok123',
    unsubscribeMailtoAddress: 'alex@getbrand.com',
    inReplyTo: '<prev-123@getbrand.com>',
    references: ['<prev-123@getbrand.com>'],
    enrollmentId: 'enr_1',
    campaignId: 'camp_1'
  });

  assert.equal(payload.sender.email, 'alex@getbrand.com');
  assert.equal(payload.sender.name, 'Alex Morgan');
  assert.equal(payload.to[0].email, 'sarah@linearflow.io');
  assert.equal(payload.to[0].name, 'Sarah');
  assert.equal(payload.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(payload.headers['List-Unsubscribe'].includes('https://api.getbrand.com/api/unsubscribe/tok123'));
  assert.equal(payload.headers['In-Reply-To'], '<prev-123@getbrand.com>');
  assert.equal(payload.headers['References'], '<prev-123@getbrand.com>');
  assert.ok(payload.headers['X-Mailin-custom'].includes('enr_1'));
});

test('resolveBrevoApiKey resolves from .env BREVO_API_KEY or encrypted credentials', () => {
  const prevEnv = process.env.BREVO_API_KEY;
  const encKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const encryptedCredentials = encryptCredentials({ brevoApiKey: 'xkeysib-test-secret-key-999' }, encKey);
  const resolved = resolveBrevoApiKey({ encryptedCredentials });
  assert.ok(resolved.startsWith('xkeysib-'));
  process.env.BREVO_API_KEY = prevEnv;
});

test('formatBrevoDomainDnsRecords and getOrCreateBrevoDomain return Brevo Code, DKIM, and DMARC records', async () => {
  const formatted = formatBrevoDomainDnsRecords('getbrand.com', {
    brevo_code: { type: 'TXT', host_name: 'getbrand.com', value: 'brevo-code:abc123', status: true },
    dkim1: { type: 'CNAME', host_name: 'brevo1._domainkey.getbrand.com', value: 'b1.getbrand-com.dkim.brevo.com', status: false }
  });
  assert.equal(formatted.length, 3); // brevo_code + dkim1 + auto-recommended dmarc
  assert.equal(formatted[0].verified, true);

  const preview = await getOrCreateBrevoDomain('getbrand.com', '');
  assert.equal(preview.domain, 'getbrand.com');
  assert.ok(preview.records.some((r) => r.key === 'brevo_code'));
  assert.ok(preview.records.some((r) => r.key === 'dkim1'));
  assert.ok(preview.records.some((r) => r.key === 'dmarc'));
});

test('buildPlainTextMime includes RFC 8058 List-Unsubscribe, List-Unsubscribe-Post, and threading headers', async () => {
  const { rawBuffer, rfc822MessageId } = await buildPlainTextMime({
    fromName: 'Alex Morgan',
    fromAddress: 'alex@getbrand.com',
    toAddress: 'sarah@linearflow.io',
    subject: 'Quick question about LinearFlow',
    textBody: 'Hi Sarah,\n\nLoved your post.\n\n--\n123 Market St',
    unsubscribeHttpsUrl: 'https://api.getbrand.com/api/unsubscribe/tok123',
    unsubscribeMailtoAddress: 'alex@getbrand.com',
    inReplyTo: '<prev-msg-id@getbrand.com>',
    references: ['<prev-msg-id@getbrand.com>']
  });

  const rawText = rawBuffer.toString('utf8');
  assert.ok(rfc822MessageId.endsWith('@getbrand.com>'));
  assert.ok(rawText.includes('From: Alex Morgan <alex@getbrand.com>'));
  assert.ok(rawText.includes('Reply-To: alex@getbrand.com'));
  assert.ok(rawText.includes('List-Unsubscribe: <mailto:alex@getbrand.com?subject=unsubscribe>,'));
  assert.ok(rawText.includes('<https://api.getbrand.com/api/unsubscribe/tok123>'));
  assert.ok(rawText.includes('List-Unsubscribe-Post: List-Unsubscribe=One-Click'));
  assert.ok(rawText.includes('In-Reply-To: <prev-msg-id@getbrand.com>'));
  assert.ok(rawText.includes('References: <prev-msg-id@getbrand.com>'));
});

test('verifySingleEmail classifies valid, risky, and invalid addresses accurately', async () => {
  const validRes = await verifySingleEmail('sarah.chen@linearflow.io');
  assert.equal(validRes.status, 'valid');

  const riskyRes = await verifySingleEmail('info@linearflow.io');
  assert.equal(riskyRes.status, 'risky');

  const invalidRes = await verifySingleEmail('bounce-test@example.invalid');
  assert.equal(invalidRes.status, 'invalid');
});

test('Mongoose models enforce hard limits (Mailbox dailyCap <= 50, Sequence steps <= 3, and required indexes)', async () => {
  // Mailbox dailyCap > 50 should fail validation
  const badMailbox = new Mailbox({
    userId: '507f1f77bcf86cd799439011',
    address: 'alex@getbrand.com',
    displayName: 'Alex',
    dailyCap: 75
  });
  const mbErr = badMailbox.validateSync();
  assert.ok(mbErr?.errors?.dailyCap, 'Mailbox dailyCap > 50 must fail validation');

  // Sequence with 4 steps should fail validation (max 3 steps)
  const badSeq = new Sequence({
    userId: '507f1f77bcf86cd799439011',
    name: 'Too Long Sequence',
    steps: [
      { delayDays: 0, subjectTemplate: 'S1', bodyTemplate: 'B1' },
      { delayDays: 3, subjectTemplate: 'S2', bodyTemplate: 'B2' },
      { delayDays: 6, subjectTemplate: 'S3', bodyTemplate: 'B3' },
      { delayDays: 9, subjectTemplate: 'S4', bodyTemplate: 'B4' }
    ]
  });
  const seqErr = badSeq.validateSync();
  assert.ok(seqErr?.errors?.steps, 'Sequence with >3 steps must fail validation');

  // Check indexes on Enrollment and SendLog
  const enrIndexes = Enrollment.schema.indexes();
  assert.ok(
    enrIndexes.some(([fields]) => fields.status === 1 && fields.nextSendAt === 1),
    'Enrollment(status, nextSendAt) index must exist'
  );

  const sendLogIndexes = SendLog.schema.indexes();
  assert.ok(
    sendLogIndexes.some(([fields, opts]) => fields.enrollmentId === 1 && fields.step === 1 && opts.unique === true),
    'SendLog(enrollmentId, step unique) index must exist'
  );
});
