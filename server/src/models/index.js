import mongoose from 'mongoose';
import {
  HARD_LIMITS,
  DEFAULT_SEND_WINDOW,
  DEFAULT_CLEARED_COUNTRIES
} from '@cold-outreach/shared';

const { Schema } = mongoose;

// 1. User Model
const userSchema = new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  name: { type: String, trim: true, default: 'Admin Operator' },
  role: { type: String, enum: ['admin', 'operator'], default: 'admin' }
}, { timestamps: true });

// 2. Mailbox Model
const mailboxSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  address: { type: String, required: true, unique: true, lowercase: true, trim: true },
  displayName: { type: String, required: true, trim: true },
  senderTitle: { type: String, trim: true, default: '' },
  senderCompany: { type: String, trim: true, default: '' },
  senderAddress: { type: String, trim: true, default: '' },
  status: {
    type: String,
    enum: ['warming', 'active', 'paused'],
    default: 'warming'
  },
  dailyCap: {
    type: Number,
    default: HARD_LIMITS.DEFAULT_DAILY_CAP,
    min: 1,
    max: HARD_LIMITS.MAX_DAILY_CAP
  },
  sentToday: { type: Number, default: 0 },
  lastResetDate: { type: String, default: () => new Date().toISOString().slice(0, 10) },
  lastScheduledAt: { type: Date, default: null },
  warmupStartDate: { type: Date, default: Date.now },
  health: {
    sent7d: { type: Number, default: 0 },
    bounces7d: { type: Number, default: 0 },
    bounceRate7d: { type: Number, default: 0 },
    complaintsCount: { type: Number, default: 0 },
    lastPausedReason: { type: String, default: '' },
    lastCheckedAt: { type: Date, default: Date.now }
  },
  authMode: {
    type: String,
    enum: ['brevo', 'service_account', 'oauth', 'mock'],
    default: 'brevo'
  },
  // AES-256-GCM encrypted credentials string (never returned to API clients)
  encryptedCredentials: { type: String, select: false, default: null }
}, { timestamps: true });

// 3. Contact Model
const contactSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  firstName: { type: String, trim: true, default: '' },
  company: { type: String, trim: true, default: '' },
  title: { type: String, trim: true, default: '' },
  timezone: { type: String, trim: true, default: 'America/New_York' },
  country: { type: String, trim: true, uppercase: true, default: 'US' },
  variables: {
    type: Schema.Types.Mixed,
    default: () => ({ custom_opener: '' })
  },
  source: { type: String, required: true, trim: true },
  sourceNote: { type: String, trim: true, default: '' },
  lawfulBasis: {
    type: String,
    required: true,
    default: 'legitimate_interest_b2b'
  },
  regionOverride: { type: Boolean, default: false },
  regionOverrideReason: { type: String, trim: true, default: '' },
  verificationStatus: {
    type: String,
    enum: ['valid', 'risky', 'invalid', 'unverified'],
    default: 'unverified'
  },
  status: {
    type: String,
    enum: ['active', 'replied', 'bounced', 'opted_out', 'paused'],
    default: 'active'
  }
}, { timestamps: true, minimize: false });

contactSchema.index({ email: 1 }, { unique: true });

// 4. Suppression Model (Global, checked everywhere)
const suppressionSchema = new Schema({
  // Can store normalized email ('user@acme.com'), domain ('@acme.com'), or SHA-256 hash when GDPR-deleted
  email: { type: String, required: true, lowercase: true, trim: true },
  type: {
    type: String,
    enum: ['email', 'domain', 'hashed_email'],
    default: 'email'
  },
  reason: {
    type: String,
    enum: ['opt_out', 'bounce', 'complaint', 'manual', 'gdpr_deleted'],
    required: true
  },
  notes: { type: String, trim: true, default: '' }
}, { timestamps: true });

suppressionSchema.index({ email: 1 }, { unique: true });

// 5. Sequence Model
const stepSchema = new Schema({
  delayDays: { type: Number, required: true, min: 0, default: 0 },
  subjectTemplate: { type: String, required: true, trim: true },
  bodyTemplate: { type: String, required: true }
}, { _id: false });

const sequenceSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  steps: {
    type: [stepSchema],
    validate: {
      validator: (arr) => Array.isArray(arr) && arr.length >= 1 && arr.length <= HARD_LIMITS.MAX_SEQUENCE_STEPS,
      message: `Sequence must have between 1 and ${HARD_LIMITS.MAX_SEQUENCE_STEPS} steps.`
    }
  },
  sendWindow: {
    days: { type: [Number], default: () => [...DEFAULT_SEND_WINDOW.days] },
    startHour: { type: Number, default: DEFAULT_SEND_WINDOW.startHour, min: 0, max: 23 },
    endHour: { type: Number, default: DEFAULT_SEND_WINDOW.endHour, min: 1, max: 24 }
  },
  stopRules: {
    onReply: { type: Boolean, default: true },
    onBounce: { type: Boolean, default: true },
    onOptOut: { type: Boolean, default: true }
  }
}, { timestamps: true });

// 6. Campaign Model
const campaignSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true },
  sequenceId: { type: Schema.Types.ObjectId, ref: 'Sequence', required: true },
  mailboxIds: [{ type: Schema.Types.ObjectId, ref: 'Mailbox' }],
  contactIds: [{ type: Schema.Types.ObjectId, ref: 'Contact' }],
  status: {
    type: String,
    enum: ['draft', 'ready', 'running', 'paused', 'done'],
    default: 'draft'
  },
  gateCheckPassed: { type: Boolean, default: false },
  lastGateCheckAt: { type: Date, default: null },
  startedAt: { type: Date, default: null }
}, { timestamps: true });

// 7. Enrollment Model
const enrollmentSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true, index: true },
  mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true, index: true },
  currentStep: { type: Number, default: 0, min: 0 },
  nextSendAt: { type: Date, required: true },
  status: {
    type: String,
    enum: ['active', 'replied', 'bounced', 'opted_out', 'paused', 'completed', 'failed'],
    default: 'active'
  },
  threadId: { type: String, default: null },
  lastMessageId: { type: String, default: null },
  lastRfc822MessageId: { type: String, default: null },
  messageReferences: { type: [String], default: [] },
  lastError: { type: String, default: null }
}, { timestamps: true });

// Required index from Section 5: Enrollment(status, nextSendAt)
enrollmentSchema.index({ status: 1, nextSendAt: 1 });
enrollmentSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });

// 8. SendLog Model
const sendLogSchema = new Schema({
  enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', required: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', required: true, index: true },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
  step: { type: Number, required: true },
  gmailMessageId: { type: String, default: null },
  threadId: { type: String, default: null },
  rfc822MessageId: { type: String, default: null },
  subject: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now },
  error: { type: String, default: null }
}, { timestamps: true });

// Required unique index for idempotency from Section 5 & 7: SendLog(enrollmentId, step unique)
sendLogSchema.index({ enrollmentId: 1, step: 1 }, { unique: true });

// 9. Event Model
const eventSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  type: {
    type: String,
    enum: ['reply', 'bounce', 'opt_out', 'complaint', 'auto_reply', 'error', 'sent'],
    required: true,
    index: true
  },
  enrollmentId: { type: Schema.Types.ObjectId, ref: 'Enrollment', index: true },
  campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', index: true },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact', index: true },
  mailboxId: { type: Schema.Types.ObjectId, ref: 'Mailbox', index: true },
  fromAddress: { type: String, default: '' },
  subject: { type: String, default: '' },
  snippet: { type: String, default: '' },
  threadId: { type: String, default: null },
  gmailMessageId: { type: String, default: null },
  optOutFlagged: { type: Boolean, default: false },
  interestedStatus: {
    type: String,
    enum: ['unreviewed', 'interested', 'not_interested', 'archived'],
    default: 'unreviewed'
  },
  rawPayloadSummary: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

// 10. ComplianceConfig Model
const complianceConfigSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  clearedCountries: {
    type: [String],
    default: () => [...DEFAULT_CLEARED_COUNTRIES]
  },
  senderPostalAddress: {
    type: String,
    default: () => process.env.SENDER_POSTAL_ADDRESS || 'Nehru Park, SCO 1, S D Market Model Town, Yamuna Nagar, Haryana 135001'
  },
  defaultSenderCompany: { type: String, default: 'Rama Consultants' },
  alertEmail: { type: String, default: () => process.env.ALERT_EMAIL || 'info@ramaconsultants.com' }
}, { timestamps: true });

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Mailbox = mongoose.models.Mailbox || mongoose.model('Mailbox', mailboxSchema);
export const Contact = mongoose.models.Contact || mongoose.model('Contact', contactSchema);
export const Suppression = mongoose.models.Suppression || mongoose.model('Suppression', suppressionSchema);
export const Sequence = mongoose.models.Sequence || mongoose.model('Sequence', sequenceSchema);
export const Campaign = mongoose.models.Campaign || mongoose.model('Campaign', campaignSchema);
export const Enrollment = mongoose.models.Enrollment || mongoose.model('Enrollment', enrollmentSchema);
export const SendLog = mongoose.models.SendLog || mongoose.model('SendLog', sendLogSchema);
export const Event = mongoose.models.Event || mongoose.model('Event', eventSchema);
export const ComplianceConfig = mongoose.models.ComplianceConfig || mongoose.model('ComplianceConfig', complianceConfigSchema);
