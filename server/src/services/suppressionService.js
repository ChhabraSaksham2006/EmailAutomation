import {
  normalizeEmail,
  hashEmailForSuppression
} from '@cold-outreach/shared';
import {
  Suppression,
  Contact,
  Enrollment
} from '../models/index.js';

/**
 * Checks if an email is suppressed globally (by exact email, domain, or SHA-256 GDPR deletion hash).
 */
export async function isEmailSuppressed(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) return { suppressed: true, reason: 'invalid_email' };

  const domainPart = email.includes('@') ? `@${email.split('@')[1]}` : '';
  const bareDomain = email.includes('@') ? email.split('@')[1] : '';
  const hashed = hashEmailForSuppression(email);

  const candidates = [email, hashed];
  if (domainPart) candidates.push(domainPart, bareDomain);

  const match = await Suppression.findOne({
    email: { $in: candidates }
  }).lean();

  if (match) {
    return {
      suppressed: true,
      reason: match.reason,
      type: match.type,
      entry: match
    };
  }

  return { suppressed: false, reason: null };
}

/**
 * Adds an email or domain to the global Suppression list and immediately stops any active enrollments.
 */
export async function addSuppression({
  email: rawInput,
  reason = 'manual',
  notes = '',
  isDomain = false
}) {
  const cleaned = normalizeEmail(rawInput);
  if (!cleaned) {
    throw new Error('Email or domain is required for suppression');
  }

  const type = isDomain || cleaned.startsWith('@')
    ? 'domain'
    : 'email';

  const normalizedKey = type === 'domain' && !cleaned.startsWith('@')
    ? `@${cleaned}`
    : cleaned;

  const entry = await Suppression.findOneAndUpdate(
    { email: normalizedKey },
    {
      $setOnInsert: {
        email: normalizedKey,
        type,
        reason,
        notes
      }
    },
    { upsert: true, new: true }
  );

  // Immediately update matching contacts and stop active enrollments
  if (type === 'email') {
    const newStatus = reason === 'bounce' ? 'bounced' : 'opted_out';
    const contact = await Contact.findOneAndUpdate(
      { email: normalizedKey },
      { $set: { status: newStatus } },
      { new: true }
    );

    if (contact) {
      await Enrollment.updateMany(
        { contactId: contact._id, status: { $in: ['active', 'paused'] } },
        { $set: { status: newStatus } }
      );
    }
  } else if (type === 'domain') {
    const domainSuffix = normalizedKey.replace(/^@/, '');
    const regex = new RegExp(`@${domainSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const contacts = await Contact.find({ email: regex }, { _id: 1 }).lean();
    if (contacts.length > 0) {
      const contactIds = contacts.map((c) => c._id);
      await Contact.updateMany(
        { _id: { $in: contactIds } },
        { $set: { status: 'opted_out' } }
      );
      await Enrollment.updateMany(
        { contactId: { $in: contactIds }, status: { $in: ['active', 'paused'] } },
        { $set: { status: 'opted_out' } }
      );
    }
  }

  return entry;
}

/**
 * GDPR / Privacy deletion on request (Section 10):
 * Removes a contact's personal data and keeps only a SHA-256 hashed entry in Suppression
 * so they can never be re-imported or emailed again.
 */
export async function gdprDeleteContact(contactId, userId) {
  const query = userId ? { _id: contactId, userId } : { _id: contactId };
  const contact = await Contact.findOne(query);
  if (!contact) {
    throw new Error('Contact not found');
  }

  const emailHash = hashEmailForSuppression(contact.email);

  // Store only the SHA-256 hash in Suppression
  await Suppression.findOneAndUpdate(
    { email: emailHash },
    {
      $setOnInsert: {
        email: emailHash,
        type: 'hashed_email',
        reason: 'gdpr_deleted',
        notes: 'Contact personal data erased upon request; SHA-256 hash retained to prevent re-import.'
      }
    },
    { upsert: true, new: true }
  );

  // Cancel any enrollments and remove contact document
  await Enrollment.deleteMany({ contactId: contact._id });
  await Contact.deleteOne({ _id: contact._id });

  return { deletedContactId: contactId, suppressionHash: emailHash };
}
