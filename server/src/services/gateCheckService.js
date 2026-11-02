import {
  HARD_LIMITS,
  DEFAULT_CLEARED_COUNTRIES,
  renderStepEmail,
  lintStepCopy,
  signUnsubscribeToken
} from '@cold-outreach/shared';
import {
  Campaign,
  Sequence,
  Mailbox,
  Contact,
  ComplianceConfig
} from '../models/index.js';
import { isEmailSuppressed } from './suppressionService.js';

/**
 * Helper to build the senderContext for a mailbox + compliance config + contact.
 */
export function buildSenderContextForMailbox(mailbox, complianceConfig, contact, campaignId = '', enrollmentId = '') {
  const apiBase = (process.env.API_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
  const secret = process.env.UNSUBSCRIBE_SIGNING_SECRET || 'dev-unsubscribe-secret-key';
  const token = signUnsubscribeToken({
    email: contact?.email || 'preview@example.com',
    campaignId,
    enrollmentId
  }, secret);

  const unsubscribeUrl = `${apiBase}/api/unsubscribe/${token}`;
  const senderAddress =
    mailbox?.senderAddress ||
    complianceConfig?.senderPostalAddress ||
    process.env.SENDER_POSTAL_ADDRESS ||
    '';

  return {
    senderName: mailbox?.displayName || 'Sender',
    senderTitle: mailbox?.senderTitle || '',
    senderCompany: mailbox?.senderCompany || complianceConfig?.defaultSenderCompany || '',
    senderAddress,
    unsubscribeUrl,
    unsubscribeToken: token
  };
}

/**
 * Runs the comprehensive Pre-Send Gate Check for a Campaign (Sections 6, 9, 10).
 * Returns { passed, summary, sequenceErrors, mailboxIssues, rowFailures, eligibleContactIds }
 */
export async function runCampaignGateCheck(campaignId, userId) {
  const campaign = await Campaign.findOne({ _id: campaignId, userId });
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  const [sequence, mailboxes, contacts, complianceConfig] = await Promise.all([
    Sequence.findOne({ _id: campaign.sequenceId, userId }).lean(),
    Mailbox.find({ _id: { $in: campaign.mailboxIds }, userId }).lean(),
    Contact.find({ _id: { $in: campaign.contactIds }, userId }).lean(),
    ComplianceConfig.findOne({ userId }).lean()
  ]);

  const sequenceErrors = [];
  const sequenceWarnings = [];
  const mailboxIssues = [];
  const rowFailures = [];
  const eligibleContactIds = [];

  // 1. Validate Sequence
  if (!sequence) {
    sequenceErrors.push('Assigned sequence does not exist.');
  } else {
    if (!Array.isArray(sequence.steps) || sequence.steps.length === 0) {
      sequenceErrors.push('Sequence has no steps.');
    } else if (sequence.steps.length > HARD_LIMITS.MAX_SEQUENCE_STEPS) {
      sequenceErrors.push(`Sequence has ${sequence.steps.length} steps; maximum allowed is ${HARD_LIMITS.MAX_SEQUENCE_STEPS}.`);
    } else {
      sequence.steps.forEach((step, idx) => {
        const lint = lintStepCopy(step, idx);
        lint.errors.forEach((e) => sequenceErrors.push(`Step ${idx + 1}: ${e}`));
        lint.warnings.forEach((w) => sequenceWarnings.push(`Step ${idx + 1}: ${w}`));
      });
    }
  }

  // 2. Validate Mailboxes
  if (!mailboxes || mailboxes.length === 0) {
    mailboxIssues.push('No mailboxes assigned to this campaign.');
  } else {
    const activeMailboxes = mailboxes.filter((m) => m.status === 'active');
    if (activeMailboxes.length === 0) {
      mailboxIssues.push('At least one assigned mailbox must have status "active" (currently all are paused or warming).');
    }
    for (const mb of mailboxes) {
      if (mb.dailyCap > HARD_LIMITS.MAX_DAILY_CAP) {
        mailboxIssues.push(`Mailbox ${mb.address} exceeds the hard ceiling of ${HARD_LIMITS.MAX_DAILY_CAP} daily sends.`);
      }
    }
  }

  // 3. Validate Postal Address requirement (Section 10)
  const sampleMailbox = mailboxes?.[0] || {};
  const effectivePostalAddress =
    sampleMailbox.senderAddress ||
    complianceConfig?.senderPostalAddress ||
    process.env.SENDER_POSTAL_ADDRESS ||
    '';

  if (!effectivePostalAddress.trim()) {
    sequenceErrors.push('Physical sender postal address is required in Compliance Settings or on the Mailbox.');
  }

  // 4. Validate Contacts (Variables, custom_opener, Verification, Suppression, Region Clearance, Lawful Basis)
  const clearedCountries = new Set(
    (complianceConfig?.clearedCountries?.length ? complianceConfig.clearedCountries : DEFAULT_CLEARED_COUNTRIES)
      .map((c) => String(c).trim().toUpperCase())
  );

  if (!contacts || contacts.length === 0) {
    rowFailures.push({
      rowIndex: 0,
      email: 'N/A',
      reasons: ['Campaign has no contacts assigned.']
    });
  } else {
    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const reasons = [];

      // Check global suppression
      const supCheck = await isEmailSuppressed(contact.email);
      if (supCheck.suppressed) {
        reasons.push(`Suppressed (${supCheck.reason})`);
      }

      // Check contact status
      if (contact.status !== 'active') {
        reasons.push(`Contact status is "${contact.status}" (must be "active")`);
      }

      // Check email verification status
      if (contact.verificationStatus === 'invalid') {
        reasons.push('Email verification status is "invalid"');
      } else if (contact.verificationStatus === 'unverified') {
        reasons.push('Email has not been verified yet (run Verify Contacts first)');
      }

      // Check source & lawful basis record (Section 10)
      if (!contact.source || !String(contact.source).trim()) {
        reasons.push('Missing contact source record');
      }
      if (!contact.lawfulBasis || !String(contact.lawfulBasis).trim()) {
        reasons.push('Missing lawful basis record');
      }

      // Check region flag clearance (Section 10)
      const countryCode = String(contact.country || '').trim().toUpperCase();
      if (!countryCode) {
        reasons.push('Missing country code for region compliance check');
      } else if (!clearedCountries.has(countryCode) && !contact.regionOverride) {
        reasons.push(`Region "${countryCode}" is blocked by default; requires cleared country or explicit lawful-basis override`);
      }

      // Check template variable resolution across all steps + required custom_opener (Section 9)
      if (sequence?.steps?.length) {
        const senderContext = buildSenderContextForMailbox(sampleMailbox, complianceConfig, contact, campaign._id);
        const missingAcrossSteps = new Set();

        for (const step of sequence.steps) {
          const rendered = renderStepEmail({
            step,
            contact,
            senderContext,
            appendFooterIfMissing: true
          });
          rendered.missingVariables.forEach((v) => missingAcrossSteps.add(v));
        }

        if (missingAcrossSteps.size > 0) {
          reasons.push(`Missing template variables: ${Array.from(missingAcrossSteps).join(', ')}`);
        }
      }

      if (reasons.length > 0) {
        rowFailures.push({
          rowIndex: i,
          contactId: contact._id,
          email: contact.email,
          firstName: contact.firstName,
          company: contact.company,
          country: contact.country,
          reasons
        });
      } else {
        eligibleContactIds.push(contact._id);
      }
    }
  }

  const passed =
    sequenceErrors.length === 0 &&
    mailboxIssues.length === 0 &&
    rowFailures.length === 0 &&
    eligibleContactIds.length > 0;

  campaign.gateCheckPassed = passed;
  campaign.lastGateCheckAt = new Date();
  if (passed && campaign.status === 'draft') {
    campaign.status = 'ready';
  }
  await campaign.save();

  return {
    passed,
    checkedAt: campaign.lastGateCheckAt,
    summary: {
      totalContacts: contacts.length,
      eligibleContacts: eligibleContactIds.length,
      failedContacts: rowFailures.length,
      sequenceErrorCount: sequenceErrors.length,
      mailboxIssueCount: mailboxIssues.length
    },
    sequenceErrors,
    sequenceWarnings,
    mailboxIssues,
    rowFailures
  };
}
