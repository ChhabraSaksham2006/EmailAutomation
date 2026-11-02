import crypto from 'node:crypto';
import fs from 'node:fs';
import { google } from 'googleapis';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import {
  sanitizeHeaderValue,
  decryptCredentials,
  normalizeEmail,
  HARD_LIMITS
} from '@cold-outreach/shared';
import { reloadEnv } from '../loadEnv.js';
import { Mailbox } from '../models/index.js';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly'
];

const BREVO_SEND_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const BREVO_ACCOUNT_ENDPOINT = 'https://api.brevo.com/v3/account';
const BREVO_SENDERS_ENDPOINT = 'https://api.brevo.com/v3/senders';
const BREVO_DOMAINS_ENDPOINT = 'https://api.brevo.com/v3/senders/domains';

/**
 * Builds a plain-text RFC 2822 / MIME message with required List-Unsubscribe headers
 * and optional threading headers (In-Reply-To, References) using Nodemailer's MailComposer.
 */
export async function buildPlainTextMime({
  fromName,
  fromAddress,
  toAddress,
  subject,
  textBody,
  unsubscribeHttpsUrl,
  unsubscribeMailtoAddress,
  inReplyTo = null,
  references = []
}) {
  const cleanFromName = sanitizeHeaderValue(fromName);
  const cleanFromAddr = sanitizeHeaderValue(fromAddress);
  const cleanToAddr = sanitizeHeaderValue(toAddress);
  const cleanSubject = sanitizeHeaderValue(subject);

  const senderDomain = cleanFromAddr.includes('@')
    ? cleanFromAddr.split('@')[1]
    : 'mail.local';
  const rfc822MessageId = `<${crypto.randomUUID()}@${senderDomain}>`;

  const unsubParts = [];
  if (unsubscribeMailtoAddress) {
    unsubParts.push(`<mailto:${sanitizeHeaderValue(unsubscribeMailtoAddress)}?subject=unsubscribe>`);
  }
  if (unsubscribeHttpsUrl) {
    unsubParts.push(`<${sanitizeHeaderValue(unsubscribeHttpsUrl)}>`);
  }

  const headers = {};
  if (unsubParts.length > 0) {
    headers['List-Unsubscribe'] = unsubParts.join(', ');
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  const mailOptions = {
    from: cleanFromName ? `"${cleanFromName.replace(/"/g, '')}" <${cleanFromAddr}>` : cleanFromAddr,
    replyTo: cleanFromAddr,
    to: cleanToAddr,
    subject: cleanSubject,
    text: textBody,
    messageId: rfc822MessageId,
    headers
  };

  if (inReplyTo) {
    mailOptions.inReplyTo = sanitizeHeaderValue(inReplyTo);
    const refList = Array.isArray(references) && references.length > 0
      ? references.map(sanitizeHeaderValue).join(' ')
      : sanitizeHeaderValue(inReplyTo);
    mailOptions.references = refList;
  }

  const composer = new MailComposer(mailOptions);
  const rawBuffer = await composer.compile().build();
  const base64UrlRaw = rawBuffer.toString('base64url');

  return {
    rawBuffer,
    base64UrlRaw,
    rfc822MessageId
  };
}

/**
 * Builds the JSON request body for Brevo's v3 Transactional Email HTTPS API (`POST /v3/smtp/email`)
 * including RFC 8058 List-Unsubscribe headers and thread headers (In-Reply-To / References).
 */
export function buildBrevoEmailPayload({
  fromName,
  fromAddress,
  toAddress,
  toName = '',
  subject,
  textBody,
  unsubscribeHttpsUrl,
  unsubscribeMailtoAddress,
  inReplyTo = null,
  references = [],
  enrollmentId = null,
  campaignId = null
}) {
  const cleanFromName = sanitizeHeaderValue(fromName) || 'Sender';
  const cleanFromAddr = sanitizeHeaderValue(fromAddress);
  const cleanToAddr = sanitizeHeaderValue(toAddress);
  const cleanToName = sanitizeHeaderValue(toName);
  const cleanSubject = sanitizeHeaderValue(subject);

  const senderDomain = cleanFromAddr.includes('@')
    ? cleanFromAddr.split('@')[1]
    : 'mail.local';
  const rfc822MessageId = `<${crypto.randomUUID()}@${senderDomain}>`;

  const unsubParts = [];
  if (unsubscribeMailtoAddress) {
    unsubParts.push(`<mailto:${sanitizeHeaderValue(unsubscribeMailtoAddress)}?subject=unsubscribe>`);
  }
  if (unsubscribeHttpsUrl) {
    unsubParts.push(`<${sanitizeHeaderValue(unsubscribeHttpsUrl)}>`);
  }

  const headers = {
    'X-Mailin-custom': JSON.stringify({
      enrollmentId: enrollmentId ? String(enrollmentId) : undefined,
      campaignId: campaignId ? String(campaignId) : undefined
    })
  };

  if (unsubParts.length > 0) {
    headers['List-Unsubscribe'] = unsubParts.join(', ');
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  if (inReplyTo) {
    headers['In-Reply-To'] = sanitizeHeaderValue(inReplyTo);
    headers['References'] = Array.isArray(references) && references.length > 0
      ? references.map(sanitizeHeaderValue).join(' ')
      : sanitizeHeaderValue(inReplyTo);
  }

  const toEntry = { email: cleanToAddr };
  if (cleanToName) {
    toEntry.name = cleanToName;
  }

  const payload = {
    sender: {
      name: cleanFromName,
      email: cleanFromAddr
    },
    to: [toEntry],
    replyTo: {
      name: cleanFromName,
      email: cleanFromAddr
    },
    subject: cleanSubject,
    textContent: textBody,
    headers,
    tags: [
      'cold-outreach',
      ...(campaignId ? [`campaign:${campaignId}`] : [])
    ]
  };

  return {
    payload,
    rfc822MessageId
  };
}

/**
 * Decrypts per-mailbox credentials if present.
 */
export function getDecryptedMailboxCredentials(mailboxWithCreds) {
  if (!mailboxWithCreds?.encryptedCredentials) return null;
  const encKey = process.env.TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  try {
    return decryptCredentials(mailboxWithCreds.encryptedCredentials, encKey);
  } catch {
    return null;
  }
}

/**
 * Resolves the Brevo API key strictly from `.env` (or legacy encrypted credentials if present).
 */
export function resolveBrevoApiKey(mailboxWithCreds) {
  reloadEnv();
  if (process.env.BREVO_API_KEY) {
    return String(process.env.BREVO_API_KEY).trim();
  }
  const customCreds = getDecryptedMailboxCredentials(mailboxWithCreds);
  return customCreds?.brevoApiKey || '';
}

/**
 * Automatically provisions and syncs sending mailboxes strictly from `.env` variables
 * (`BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_SENDER_TITLE`, `BREVO_SENDER_COMPANY`,
 * `BREVO_DAILY_CAP`, `SENDER_POSTAL_ADDRESS`) and any verified senders on the `.env` `BREVO_API_KEY`.
 */
export async function syncEnvMailboxesForUser(userId) {
  reloadEnv();
  if (!userId) return [];

  const rawEmails = String(process.env.BREVO_SENDER_EMAIL || 'info@ramaconsultants.com')
    .split(',')
    .map((e) => normalizeEmail(e))
    .filter((e) => e && e.includes('@'));

  const defaultName = String(process.env.BREVO_SENDER_NAME || 'Rama Consultants').trim();
  const defaultTitle = String(process.env.BREVO_SENDER_TITLE || 'Consultant').trim();
  const defaultCompany = String(process.env.BREVO_SENDER_COMPANY || 'Rama Consultants').trim();
  const defaultAddress = String(
    process.env.SENDER_POSTAL_ADDRESS || 'Nehru Park, SCO 1, S D Market Model Town, Yamuna Nagar, Haryana 135001'
  ).trim();
  const defaultCap = Math.min(
    HARD_LIMITS.MAX_DAILY_CAP,
    Math.max(1, Number(process.env.BREVO_DAILY_CAP || HARD_LIMITS.DEFAULT_DAILY_CAP))
  );

  const sendersToSync = rawEmails.map((email) => ({
    email,
    name: defaultName
  }));

  // If BREVO_API_KEY is configured in .env, also pull active verified senders from Brevo
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  if (apiKey && !apiKey.startsWith('xkeysib-replace')) {
    try {
      const res = await fetch(BREVO_SENDERS_ENDPOINT, {
        headers: {
          accept: 'application/json',
          'api-key': apiKey
        }
      });
      if (res.ok) {
        const data = await res.json();
        for (const s of data.senders || []) {
          if (s.active && s.email) {
            const norm = normalizeEmail(s.email);
            if (!sendersToSync.some((x) => x.email === norm)) {
              sendersToSync.push({
                email: norm,
                name: String(s.name || defaultName).trim()
              });
            }
          }
        }
      }
    } catch {
      // Fallback to BREVO_SENDER_EMAIL from .env if offline
    }
  }

  for (const s of sendersToSync) {
    const existing = await Mailbox.findOne({ address: s.email });
    if (!existing) {
      await Mailbox.create({
        userId,
        address: s.email,
        displayName: s.name || defaultName,
        senderTitle: defaultTitle,
        senderCompany: defaultCompany,
        senderAddress: defaultAddress,
        status: 'active',
        dailyCap: defaultCap,
        authMode: 'brevo'
      });
    } else {
      // Ensure existing mailbox belongs to user and uses .env metadata
      existing.userId = userId;
      existing.authMode = 'brevo';
      if (!existing.displayName) existing.displayName = s.name || defaultName;
      if (!existing.senderCompany) existing.senderCompany = defaultCompany;
      if (
        !existing.senderAddress ||
        existing.senderAddress === '123 Market St, Suite 400, San Francisco, CA 94105, USA'
      ) {
        existing.senderAddress = defaultAddress;
      }
      await existing.save();
    }
  }

  return Mailbox.find({ userId }).sort({ createdAt: 1 });
}

/**
 * Verifies a Brevo v3 HTTP API key against `GET https://api.brevo.com/v3/account` and `/v3/senders`.
 * Checks Free Plan credits and verified sender addresses.
 */
export async function checkBrevoApiConfiguration(rawApiKey) {
  reloadEnv();
  const apiKey = String(rawApiKey || process.env.BREVO_API_KEY || '').trim();
  if (!apiKey) {
    return {
      connected: false,
      mode: 'brevo_dry_run',
      message: 'No BREVO_API_KEY provided yet. Running in local dry-run mode until you add your xkeysib-... key.'
    };
  }

  const headers = {
    accept: 'application/json',
    'api-key': apiKey
  };

  const [accRes, sendersRes] = await Promise.all([
    fetch(BREVO_ACCOUNT_ENDPOINT, { headers }),
    fetch(BREVO_SENDERS_ENDPOINT, { headers })
  ]);

  const accData = await accRes.json().catch(() => ({}));
  if (!accRes.ok) {
    return {
      connected: false,
      status: accRes.status,
      code: accData.code || 'brevo_auth_failed',
      message: accData.message || `Brevo API rejected key (HTTP ${accRes.status}). If error mentions unrecognized IP, disable IP blocking in Brevo -> Security -> Authorized IPs.`
    };
  }

  const sendersData = await sendersRes.json().catch(() => ({ senders: [] }));
  const verifiedSenders = (sendersData.senders || [])
    .filter((s) => s.active)
    .map((s) => ({ name: s.name, email: s.email }));

  const freePlan = (accData.plan || []).find((p) => p.type === 'free') || accData.plan?.[0] || null;

  return {
    connected: true,
    accountEmail: accData.email,
    companyName: accData.companyName,
    planType: freePlan?.type || 'free',
    creditsRemaining: freePlan?.credits ?? 300,
    verifiedSenders
  };
}

/**
 * Normalizes DNS records returned by Brevo's `/v3/senders/domains` endpoints into a clean array
 * of { key, type, host, value, status } for easy display and copy-pasting.
 */
export function formatBrevoDomainDnsRecords(domainName, dnsRecordsObj = {}) {
  const records = [];
  for (const [key, rec] of Object.entries(dnsRecordsObj || {})) {
    if (!rec || typeof rec !== 'object') continue;
    records.push({
      key,
      type: rec.type || 'TXT',
      host: rec.host_name || domainName,
      value: rec.value || '',
      verified: Boolean(rec.status)
    });
  }

  // Always include recommended SPF & DMARC guidance if not already returned
  const hasDmarc = records.some((r) => r.key.toLowerCase().includes('dmarc') || String(r.host).startsWith('_dmarc'));
  if (!hasDmarc && domainName) {
    records.push({
      key: 'dmarc_recommended',
      type: 'TXT',
      host: `_dmarc.${domainName}`,
      value: `v=DMARC1; p=none; rua=mailto:dmarc@${domainName}; pct=100; adkim=r; aspf=r`,
      verified: false
    });
  }

  return records;
}

/**
 * Lists all domains in Brevo or registers/inspects a specific domain (`GET/POST /v3/senders/domains`).
 * Works on the Brevo Free Plan HTTP API!
 */
export async function getOrCreateBrevoDomain(domainName, rawApiKey) {
  reloadEnv();
  const apiKey = rawApiKey !== undefined
    ? String(rawApiKey).trim()
    : String(process.env.BREVO_API_KEY || '').trim();
  const cleanDomain = String(domainName || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

  if (!cleanDomain || !cleanDomain.includes('.')) {
    throw new Error('Please provide a valid domain name (e.g. getbrand.com).');
  }

  if (!apiKey) {
    // Provide realistic Brevo DNS records preview when in local dry-run mode without an API key
    return {
      mode: 'brevo_dry_run',
      domain: cleanDomain,
      authenticated: false,
      message: 'Previewing required Brevo DNS records (add BREVO_API_KEY to register live in Brevo).',
      records: [
        {
          key: 'brevo_code',
          type: 'TXT',
          host: cleanDomain,
          value: `brevo-code:${crypto.createHash('md5').update(cleanDomain).digest('hex')}`,
          verified: false
        },
        {
          key: 'dkim1',
          type: 'CNAME',
          host: `brevo1._domainkey.${cleanDomain}`,
          value: 'b1.getbrand-com.dkim.brevo.com',
          verified: false
        },
        {
          key: 'dkim2',
          type: 'CNAME',
          host: `brevo2._domainkey.${cleanDomain}`,
          value: 'b2.getbrand-com.dkim.brevo.com',
          verified: false
        },
        {
          key: 'dmarc',
          type: 'TXT',
          host: `_dmarc.${cleanDomain}`,
          value: `v=DMARC1; p=none; rua=mailto:dmarc@${cleanDomain}`,
          verified: false
        }
      ]
    };
  }

  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'api-key': apiKey
  };

  // First try fetching existing domain configuration from Brevo
  const getRes = await fetch(`${BREVO_DOMAINS_ENDPOINT}/${encodeURIComponent(cleanDomain)}`, {
    method: 'GET',
    headers
  });

  if (getRes.ok) {
    const data = await getRes.json();
    return {
      mode: 'brevo_api',
      domain: data.domain_name || cleanDomain,
      authenticated: Boolean(data.authenticated),
      records: formatBrevoDomainDnsRecords(cleanDomain, data.dns_records)
    };
  }

  // If not found (404), create the domain in Brevo (`POST /v3/senders/domains`)
  const createRes = await fetch(BREVO_DOMAINS_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: cleanDomain })
  });

  const createData = await createRes.json().catch(() => ({}));
  if (!createRes.ok) {
    throw new Error(createData.message || `Brevo domain API error (${createRes.status})`);
  }

  return {
    mode: 'brevo_api',
    domain: createData.domain_name || cleanDomain,
    authenticated: Boolean(createData.authenticated),
    message: createData.message || 'Domain registered in Brevo. Add the DNS records below to your DNS provider.',
    records: formatBrevoDomainDnsRecords(cleanDomain, createData.dns_records)
  };
}

/**
 * Triggers Brevo to verify the domain's DNS records (`PUT /v3/senders/domains/{domainName}/authenticate`).
 */
export async function authenticateBrevoDomain(domainName, rawApiKey) {
  const apiKey = String(rawApiKey || process.env.BREVO_API_KEY || '').trim();
  const cleanDomain = String(domainName || '').trim().toLowerCase();

  if (!cleanDomain) {
    throw new Error('Domain name is required.');
  }
  if (!apiKey) {
    throw new Error('BREVO_API_KEY is required to run live DNS verification with Brevo.');
  }

  const headers = {
    accept: 'application/json',
    'api-key': apiKey
  };

  const authRes = await fetch(`${BREVO_DOMAINS_ENDPOINT}/${encodeURIComponent(cleanDomain)}/authenticate`, {
    method: 'PUT',
    headers
  });

  const authData = await authRes.json().catch(() => ({}));
  if (!authRes.ok) {
    throw new Error(authData.message || `Domain DNS verification failed (${authRes.status}). Make sure DNS records have propagated.`);
  }

  // Fetch updated record statuses after authentication call
  const updated = await getOrCreateBrevoDomain(cleanDomain, apiKey);
  return {
    ...updated,
    message: authData.message || (updated.authenticated ? 'Domain is now authenticated in Brevo!' : 'DNS records checked; some records are still pending propagation.')
  };
}

/**
 * Sends a plain-text outreach email over HTTPS using Brevo's v3 Transactional Email API.
 */
export async function sendViaBrevoApi({
  mailbox,
  toAddress,
  toName = '',
  subject,
  textBody,
  unsubscribeHttpsUrl,
  threadId = null,
  inReplyTo = null,
  references = [],
  enrollmentId = null,
  campaignId = null
}) {
  const { payload, rfc822MessageId } = buildBrevoEmailPayload({
    fromName: mailbox.displayName,
    fromAddress: mailbox.address,
    toAddress,
    toName,
    subject,
    textBody,
    unsubscribeHttpsUrl,
    unsubscribeMailtoAddress: mailbox.address,
    inReplyTo,
    references,
    enrollmentId,
    campaignId
  });

  const apiKey = resolveBrevoApiKey(mailbox);

  if (!apiKey) {
    // Fallback to dry-run simulation when BREVO_API_KEY is not yet configured in local dev
    const mockMsgId = `<brevo_mock_${crypto.randomBytes(6).toString('hex')}@smtp-relay.mailin.fr>`;
    const effectiveThreadId = threadId || mockMsgId;
    return {
      gmailMessageId: mockMsgId,
      threadId: effectiveThreadId,
      rfc822MessageId: mockMsgId,
      mode: 'brevo_dry_run',
      brevoPayloadPreview: payload
    };
  }

  const response = await fetch(BREVO_SEND_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'api-key': apiKey
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err = new Error(data.message || `Brevo API error (${response.status})`);
    err.status = response.status;
    err.code = response.status;
    err.brevoCode = data.code;
    throw err;
  }

  const brevoMessageId = data.messageId || rfc822MessageId;
  return {
    gmailMessageId: brevoMessageId,
    threadId: threadId || brevoMessageId,
    rfc822MessageId: brevoMessageId,
    mode: 'brevo_api'
  };
}

/**
 * Resolves an authenticated Gmail API client for a given Mailbox document (when using Gmail mode).
 */
export async function getGmailClientForMailbox(mailboxWithCreds) {
  if (!mailboxWithCreds || mailboxWithCreds.authMode === 'mock' || mailboxWithCreds.authMode === 'brevo') {
    return null;
  }

  const customCreds = getDecryptedMailboxCredentials(mailboxWithCreds);

  // OAuth2 mode
  if (mailboxWithCreds.authMode === 'oauth' && customCreds?.refreshToken) {
    const clientId = customCreds.clientId || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = customCreds.clientSecret || process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = customCreds.redirectUri || process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret) {
      throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required for OAuth mailbox mode');
    }
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    oauth2Client.setCredentials({
      refresh_token: customCreds.refreshToken,
      access_token: customCreds.accessToken
    });
    return google.gmail({ version: 'v1', auth: oauth2Client });
  }

  // Service Account with Domain-Wide Delegation mode
  const rawSa = customCreds?.serviceAccountJson || process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!rawSa) {
    return null;
  }

  let saKey;
  if (typeof rawSa === 'object') {
    saKey = rawSa;
  } else if (String(rawSa).trim().startsWith('{')) {
    saKey = JSON.parse(rawSa);
  } else if (fs.existsSync(rawSa)) {
    saKey = JSON.parse(fs.readFileSync(rawSa, 'utf8'));
  } else {
    throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON configuration');
  }

  const jwtClient = new google.auth.JWT({
    email: saKey.client_email,
    key: saKey.private_key,
    scopes: GMAIL_SCOPES,
    subject: mailboxWithCreds.address
  });

  await jwtClient.authorize();
  return google.gmail({ version: 'v1', auth: jwtClient });
}

/**
 * Dispatches an outreach email via Brevo HTTPS API (when mailbox.authMode === 'brevo' or BREVO_API_KEY is set),
 * Gmail API, or local dry-run mock transport.
 */
export async function sendViaGmailApi({
  mailbox,
  toAddress,
  toName = '',
  subject,
  textBody,
  unsubscribeHttpsUrl,
  threadId = null,
  inReplyTo = null,
  references = [],
  enrollmentId = null,
  campaignId = null
}) {
  // Route to Brevo v3 HTTPS API when mailbox is configured for Brevo
  if (mailbox?.authMode === 'brevo') {
    return sendViaBrevoApi({
      mailbox,
      toAddress,
      toName,
      subject,
      textBody,
      unsubscribeHttpsUrl,
      threadId,
      inReplyTo,
      references,
      enrollmentId,
      campaignId
    });
  }

  const { base64UrlRaw, rfc822MessageId, rawBuffer } = await buildPlainTextMime({
    fromName: mailbox.displayName,
    fromAddress: mailbox.address,
    toAddress,
    subject,
    textBody,
    unsubscribeHttpsUrl,
    unsubscribeMailtoAddress: mailbox.address,
    inReplyTo,
    references
  });

  const gmail = await getGmailClientForMailbox(mailbox);

  if (!gmail) {
    const mockMsgId = `mock_msg_${crypto.randomBytes(6).toString('hex')}`;
    const mockThreadId = threadId || `mock_thread_${crypto.randomBytes(6).toString('hex')}`;
    return {
      gmailMessageId: mockMsgId,
      threadId: mockThreadId,
      rfc822MessageId,
      mode: 'mock',
      rawMimePreview: rawBuffer.toString('utf8')
    };
  }

  const requestBody = { raw: base64UrlRaw };
  if (threadId) {
    requestBody.threadId = threadId;
  }

  const response = await gmail.users.messages.send({
    userId: 'me',
    requestBody
  });

  return {
    gmailMessageId: response.data.id,
    threadId: response.data.threadId || threadId,
    rfc822MessageId,
    mode: 'gmail_api'
  };
}
