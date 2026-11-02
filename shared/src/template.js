/**
 * Handlebars-style plain-text template renderer, validator, and header sanitizer.
 * Supports:
 * - {{variable_name}}
 * - {{default variable_name "fallback text"}}
 */

const TOKEN_REGEX = /\{\{\s*(?:default\s+([a-zA-Z0-9_]+)\s+["']([^"']*)["']|([a-zA-Z0-9_]+))\s*\}\}/g;

/**
 * Strips CR, LF, and control characters from header fields (Subject, From, Reply-To, To)
 * to prevent MIME header injection.
 */
export function sanitizeHeaderValue(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\r\n\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sanitizes body variable values (plain text only, normalizes line endings, removes null/control chars).
 */
export function sanitizeBodyVariable(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}

/**
 * Flatten contact fields + contact.variables + sender context into a single lookup dictionary.
 */
export function buildTemplateContext(contact = {}, senderContext = {}) {
  const vars = contact.variables instanceof Map
    ? Object.fromEntries(contact.variables)
    : (contact.variables || {});

  return {
    ...vars,
    email: contact.email || '',
    first_name: contact.firstName || vars.first_name || '',
    firstName: contact.firstName || vars.first_name || '',
    company: contact.company || vars.company || '',
    title: contact.title || vars.title || '',
    country: contact.country || vars.country || '',
    custom_opener: vars.custom_opener || contact.customOpener || '',
    sender_name: senderContext.senderName || senderContext.displayName || '',
    sender_title: senderContext.senderTitle || '',
    sender_company: senderContext.senderCompany || '',
    sender_address: senderContext.senderAddress || '',
    unsubscribe_url: senderContext.unsubscribeUrl || ''
  };
}

/**
 * Extracts variables used in a template string.
 * Returns { allVariables: string[], requiredVariables: string[], optionalVariables: string[] }
 */
export function extractTemplateVariables(templateStr = '') {
  const all = new Set();
  const required = new Set();
  const optional = new Set();

  let match;
  const regex = new RegExp(TOKEN_REGEX.source, 'g');
  while ((match = regex.exec(templateStr)) !== null) {
    const [, defaultVarName, , directVarName] = match;
    if (defaultVarName) {
      all.add(defaultVarName);
      optional.add(defaultVarName);
    } else if (directVarName) {
      all.add(directVarName);
      if (!optional.has(directVarName)) {
        required.add(directVarName);
      }
    }
  }

  // If a variable is used both with and without default, it is still required where used without default
  return {
    allVariables: Array.from(all),
    requiredVariables: Array.from(required),
    optionalVariables: Array.from(optional)
  };
}

/**
 * Renders a template string with a flat variables object.
 * Returns { rendered, missingVariables }
 */
export function renderTemplate(templateStr = '', context = {}, { isHeader = false } = {}) {
  const missingVariables = [];
  const regex = new RegExp(TOKEN_REGEX.source, 'g');

  const rendered = String(templateStr).replace(regex, (fullMatch, defaultVarName, fallbackVal, directVarName) => {
    const varName = defaultVarName || directVarName;
    const rawVal = context[varName];
    const cleanVal = isHeader ? sanitizeHeaderValue(rawVal) : sanitizeBodyVariable(rawVal);

    if (cleanVal && cleanVal.length > 0) {
      return cleanVal;
    }

    if (defaultVarName !== undefined) {
      return isHeader ? sanitizeHeaderValue(fallbackVal) : sanitizeBodyVariable(fallbackVal);
    }

    missingVariables.push(varName);
    return '';
  });

  return {
    rendered: isHeader ? sanitizeHeaderValue(rendered) : rendered,
    missingVariables: Array.from(new Set(missingVariables))
  };
}

/**
 * Renders both subject and body for a sequence step and appends compliance footer if missing.
 */
export function renderStepEmail({
  step,
  contact,
  senderContext,
  appendFooterIfMissing = true
}) {
  const context = buildTemplateContext(contact, senderContext);

  const subjectResult = renderTemplate(step.subjectTemplate || '', context, { isHeader: true });
  const bodyResult = renderTemplate(step.bodyTemplate || '', context, { isHeader: false });

  const missingVariables = Array.from(
    new Set([...subjectResult.missingVariables, ...bodyResult.missingVariables])
  );

  let finalBody = bodyResult.rendered;

  // Ensure sender postal address and opt-out footer exist in every sent email (Section 10)
  if (appendFooterIfMissing) {
    const address = sanitizeBodyVariable(senderContext.senderAddress || '');
    const unsubUrl = sanitizeBodyVariable(senderContext.unsubscribeUrl || '');
    const footerLines = [];

    if (address && !finalBody.includes(address)) {
      footerLines.push(`${senderContext.senderName || ''}${senderContext.senderCompany ? ' · ' + senderContext.senderCompany : ''} · ${address}`.replace(/^\s*·\s*/, ''));
    }

    const hasOptOutPhrase = /unsubscribe|no thanks|not now|opt out|stop/i.test(finalBody);
    if (!hasOptOutPhrase && unsubUrl) {
      footerLines.push(`To opt out of future emails, reply "unsubscribe" or visit: ${unsubUrl}`);
    } else if (unsubUrl && !finalBody.includes(unsubUrl)) {
      footerLines.push(`Opt out anytime: ${unsubUrl}`);
    }

    if (footerLines.length > 0) {
      finalBody = `${finalBody.trim()}\n\n--\n${footerLines.join('\n')}`;
    }
  }

  return {
    subject: subjectResult.rendered,
    body: finalBody,
    missingVariables
  };
}

/**
 * Lints sequence step copy against Section 11 rules:
 * - 50 to 120 words recommended
 * - Plain text only (no HTML tags or tracking pixels)
 * - No links in Email 1 (or at most 1 link to own domain)
 * - Honest subject, no fake "Re:" or "Fwd:" in Email 1
 */
export function lintStepCopy(step, stepIndex = 0) {
  const warnings = [];
  const errors = [];
  const subject = String(step.subjectTemplate || '').trim();
  const body = String(step.bodyTemplate || '').trim();

  if (!subject) {
    errors.push('Subject template cannot be empty.');
  }
  if (!body) {
    errors.push('Body template cannot be empty.');
  }

  // Fake Re:/Fwd: on Email 1
  if (stepIndex === 0 && /^(re|fwd|fw)\s*:/i.test(subject)) {
    errors.push('Email 1 cannot use a fake "Re:" or "Fwd:" prefix in the subject line.');
  }

  // Check for HTML tags
  if (/<(html|body|div|p|img|a|table|br|span)\b/i.test(body)) {
    errors.push('Plain text only: HTML tags and tracking pixels are not allowed.');
  }

  // Word count check
  const words = body.split(/\s+/).filter(Boolean);
  if (words.length < 30) {
    warnings.push(`Copy is very short (${words.length} words). Target is 50–120 words.`);
  } else if (words.length > 140) {
    warnings.push(`Copy is long (${words.length} words). Target is 50–120 words for higher reply rates.`);
  }

  // Links check in Email 1
  const urlMatches = body.match(/https?:\/\/[^\s)]+/gi) || [];
  if (stepIndex === 0 && urlMatches.length > 1) {
    errors.push(`Email 1 contains ${urlMatches.length} links. Use 0 links (or at most 1 link to your own domain).`);
  } else if (stepIndex === 0 && urlMatches.length === 1) {
    warnings.push('Email 1 contains 1 link. Zero links in Email 1 is safest for cold deliverability.');
  }

  return {
    valid: errors.length === 0,
    wordCount: words.length,
    linkCount: urlMatches.length,
    errors,
    warnings
  };
}
