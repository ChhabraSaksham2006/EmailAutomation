import crypto from 'node:crypto';

/**
 * Normalize an email address for storage/lookup.
 */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/**
 * SHA-256 hash of a normalized email address for GDPR deletion records in Suppression.
 * Allows checking if an email was previously deleted without storing PII.
 */
export function hashEmailForSuppression(email) {
  const normalized = normalizeEmail(email);
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Signs an unsubscribe token using HMAC-SHA256 so links cannot be forged (Section 13).
 * Token format: base64url(JSON payload) + '.' + base64url(HMAC signature)
 */
export function signUnsubscribeToken(payload, secret) {
  if (!secret) {
    throw new Error('UNSUBSCRIBE_SIGNING_SECRET is required to sign unsubscribe tokens');
  }
  const data = Buffer.from(JSON.stringify({
    e: normalizeEmail(payload.email),
    c: payload.campaignId ? String(payload.campaignId) : undefined,
    n: payload.enrollmentId ? String(payload.enrollmentId) : undefined,
    iat: payload.iat || Math.floor(Date.now() / 1000)
  })).toString('base64url');

  const sig = crypto
    .createHmac('sha256', String(secret))
    .update(data)
    .digest('base64url');

  return `${data}.${sig}`;
}

/**
 * Verifies an HMAC-signed unsubscribe token and returns the decoded payload or null if invalid.
 */
export function verifyUnsubscribeToken(token, secret) {
  if (!token || !secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [data, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', String(secret))
    .update(data)
    .digest('base64url');

  const bufA = Buffer.from(providedSig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'));
    if (!parsed.e) return null;
    return {
      email: normalizeEmail(parsed.e),
      campaignId: parsed.c,
      enrollmentId: parsed.n,
      iat: parsed.iat
    };
  } catch {
    return null;
  }
}

/**
 * Derives a 32-byte key from TOKEN_ENCRYPTION_KEY (supports 64-char hex or arbitrary passphrase).
 */
function deriveKey(rawKey) {
  if (!rawKey) {
    throw new Error('TOKEN_ENCRYPTION_KEY is required for credential encryption');
  }
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }
  return crypto.createHash('sha256').update(String(rawKey)).digest();
}

/**
 * Encrypts sensitive mailbox credentials at rest using AES-256-GCM (Section 13).
 */
export function encryptCredentials(credentialsObj, rawKey) {
  if (!credentialsObj) return null;
  const key = deriveKey(rawKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const plaintext = typeof credentialsObj === 'string'
    ? credentialsObj
    : JSON.stringify(credentialsObj);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('base64url')}.${authTag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

/**
 * Decrypts AES-256-GCM encrypted mailbox credentials.
 */
export function decryptCredentials(ciphertext, rawKey) {
  if (!ciphertext) return null;
  const key = deriveKey(rawKey);
  const parts = String(ciphertext).split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential format');
  }

  const [ivB64, tagB64, encB64] = parts;
  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const encrypted = Buffer.from(encB64, 'base64url');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  try {
    return JSON.parse(decrypted);
  } catch {
    return decrypted;
  }
}
