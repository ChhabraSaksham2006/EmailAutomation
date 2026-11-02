import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeHeaderValue,
  extractTemplateVariables,
  renderTemplate,
  renderStepEmail,
  lintStepCopy,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  encryptCredentials,
  decryptCredentials,
  hashEmailForSuppression,
  isWithinSendWindow
} from '../src/index.js';

test('sanitizeHeaderValue strips CRLF and prevents header injection', () => {
  const malicious = 'Acme Corp\r\nBcc: victim@example.com\nSubject: Injected';
  const cleaned = sanitizeHeaderValue(malicious);
  assert.equal(cleaned, 'Acme Corp Bcc: victim@example.com Subject: Injected');
  assert.equal(cleaned.includes('\r'), false);
  assert.equal(cleaned.includes('\n'), false);
});

test('extractTemplateVariables and renderTemplate support defaults and detect missing variables', () => {
  const tpl = 'Hi {{default first_name "there"}}, saw your work at {{company}}. {{custom_opener}}';
  const extracted = extractTemplateVariables(tpl);
  assert.deepEqual(extracted.requiredVariables.sort(), ['company', 'custom_opener']);
  assert.deepEqual(extracted.optionalVariables, ['first_name']);

  const okRender = renderTemplate(tpl, {
    company: 'Linear',
    custom_opener: 'Loved your recent changelog post on cycle velocity.'
  });
  assert.equal(okRender.missingVariables.length, 0);
  assert.equal(okRender.rendered, 'Hi there, saw your work at Linear. Loved your recent changelog post on cycle velocity.');

  const missingRender = renderTemplate(tpl, { first_name: 'Alex' });
  assert.deepEqual(missingRender.missingVariables.sort(), ['company', 'custom_opener']);
});

test('renderStepEmail renders variables and appends compliance footer', () => {
  const step = {
    subjectTemplate: 'Quick question about {{company}}',
    bodyTemplate: 'Hi {{default first_name "there"}},\n\nWould love to connect regarding {{company}}.'
  };
  const contact = {
    email: 'alex@acme.io',
    firstName: 'Alex',
    company: 'Acme',
    variables: {}
  };
  const senderContext = {
    senderName: 'Jordan Lee',
    senderCompany: 'ReachHQ',
    senderAddress: '100 Main St, Austin, TX',
    unsubscribeUrl: 'https://app.example.com/unsubscribe/tok123'
  };

  const rendered = renderStepEmail({ step, contact, senderContext });
  assert.equal(rendered.missingVariables.length, 0);
  assert.equal(rendered.subject, 'Quick question about Acme');
  assert.ok(rendered.body.includes('100 Main St, Austin, TX'));
  assert.ok(rendered.body.includes('https://app.example.com/unsubscribe/tok123'));

  // Missing required variable (company) should flag missingVariables
  const contactWithoutCompany = { email: 'alex@acme.io', variables: {} };
  const failed = renderStepEmail({ step, contact: contactWithoutCompany, senderContext });
  assert.ok(failed.missingVariables.includes('company'));
});

test('lintStepCopy catches fake Re:, HTML tags, and excessive links in Step 1', () => {
  const badStep = {
    subjectTemplate: 'Re: Quick question',
    bodyTemplate: '<p>Hello {{first_name}}</p> check https://a.com and https://b.com'
  };
  const report = lintStepCopy(badStep, 0);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((e) => e.includes('fake "Re:"')));
  assert.ok(report.errors.some((e) => e.includes('Plain text only')));
  assert.ok(report.errors.some((e) => e.includes('links')));
});

test('signUnsubscribeToken and verifyUnsubscribeToken prevent tampering', () => {
  const secret = 'test-hmac-secret-12345';
  const token = signUnsubscribeToken({
    email: 'Prospect@Example.com',
    campaignId: 'camp1',
    enrollmentId: 'enr1'
  }, secret);

  const verified = verifyUnsubscribeToken(token, secret);
  assert.ok(verified);
  assert.equal(verified.email, 'prospect@example.com');
  assert.equal(verified.campaignId, 'camp1');
  assert.equal(verified.enrollmentId, 'enr1');

  // Tampered signature must fail
  assert.equal(verifyUnsubscribeToken(`${token}tampered`, secret), null);
  assert.equal(verifyUnsubscribeToken(token, 'wrong-secret'), null);
});

test('encryptCredentials and decryptCredentials round-trip with AES-256-GCM', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const secretObj = { refreshToken: '1//0gxyz', mode: 'oauth' };
  const encrypted = encryptCredentials(secretObj, key);
  assert.notEqual(encrypted, JSON.stringify(secretObj));
  const decrypted = decryptCredentials(encrypted, key);
  assert.deepEqual(decrypted, secretObj);
});

test('hashEmailForSuppression normalizes and hashes deterministically', () => {
  const h1 = hashEmailForSuppression('  Alice@Example.COM ');
  const h2 = hashEmailForSuppression('alice@example.com');
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

test('isWithinSendWindow checks local recipient timezone', () => {
  // 2026-11-03 is a Tuesday. 14:30 UTC is 09:30 in America/New_York (EST, UTC-5)
  const tueMorningEst = new Date('2026-11-03T14:30:00Z');
  assert.equal(isWithinSendWindow(tueMorningEst, 'America/New_York', {
    days: [2, 3, 4],
    startHour: 9,
    endHour: 11
  }), true);

  // 20:30 UTC is 15:30 in America/New_York (outside 9-11 window)
  const tueAfternoonEst = new Date('2026-11-03T20:30:00Z');
  assert.equal(isWithinSendWindow(tueAfternoonEst, 'America/New_York', {
    days: [2, 3, 4],
    startHour: 9,
    endHour: 11
  }), false);
});
