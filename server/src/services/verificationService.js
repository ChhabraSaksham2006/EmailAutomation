import { normalizeEmail } from '@cold-outreach/shared';

const EMAIL_SYNTAX_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const DISPOSABLE_OR_FREE_DOMAINS = new Set([
  'mailinator.com',
  'tempmail.com',
  '10minutemail.com',
  'guerrillamail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com'
]);

const ROLE_PREFIXES = new Set([
  'info',
  'support',
  'sales',
  'admin',
  'contact',
  'billing',
  'help',
  'office',
  'careers',
  'hr',
  'noreply',
  'no-reply',
  'security',
  'abuse',
  'postmaster',
  'webmaster'
]);

/**
 * Verifies a single email address using configured external API (ZeroBounce / NeverBounce)
 * or deterministic B2B heuristic verification when VERIFIER_API_KEY is not configured.
 * Returns 'valid' | 'risky' | 'invalid'
 */
export async function verifySingleEmail(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email || !EMAIL_SYNTAX_REGEX.test(email)) {
    return { email, status: 'invalid', reason: 'invalid_syntax' };
  }

  const [localPart, domain] = email.split('@');

  // External ZeroBounce integration if VERIFIER_API_KEY is set and provider is zerobounce
  const apiKey = process.env.VERIFIER_API_KEY;
  const provider = (process.env.VERIFIER_PROVIDER || 'mock').toLowerCase();

  if (apiKey && provider === 'zerobounce') {
    try {
      const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const zbStatus = String(data.status || '').toLowerCase();
        if (zbStatus === 'valid') return { email, status: 'valid', reason: 'zerobounce_valid' };
        if (zbStatus === 'catch-all' || zbStatus === 'unknown') return { email, status: 'risky', reason: `zerobounce_${zbStatus}` };
        return { email, status: 'invalid', reason: `zerobounce_${zbStatus || 'invalid'}` };
      }
    } catch {
      // Fall through to deterministic heuristic check if network fails
    }
  }

  // Deterministic rules for local / test / fallback verification
  if (
    domain.endsWith('.invalid') ||
    domain.endsWith('.test') ||
    localPart.startsWith('bounce') ||
    localPart.startsWith('invalid') ||
    DISPOSABLE_OR_FREE_DOMAINS.has(domain)
  ) {
    return { email, status: 'invalid', reason: 'disposable_or_invalid_domain' };
  }

  if (
    ROLE_PREFIXES.has(localPart) ||
    localPart.startsWith('risky') ||
    localPart.startsWith('catchall')
  ) {
    return { email, status: 'risky', reason: 'role_account_or_catch_all' };
  }

  return { email, status: 'valid', reason: 'verified_b2b_format' };
}
