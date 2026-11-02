import { Router } from 'express';
import {
  renderStepEmail,
  getRandomPacingMs
} from '@cold-outreach/shared';
import {
  Campaign,
  Sequence,
  Mailbox,
  Contact,
  Enrollment,
  SendLog,
  Event,
  ComplianceConfig
} from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  runCampaignGateCheck,
  buildSenderContextForMailbox
} from '../services/gateCheckService.js';
import { sendViaGmailApi } from '../services/gmailService.js';
import {
  runSchedulerTick,
  processIncomingMessage
} from '../services/sendingEngineService.js';

const router = Router();
router.use(requireAuth);

// GET /campaigns
router.get('/', async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.user._id })
      .populate('sequenceId', 'name steps')
      .populate('mailboxIds', 'address displayName status sentToday dailyCap health')
      .sort({ createdAt: -1 })
      .lean();

    const enriched = await Promise.all(
      campaigns.map(async (camp) => {
        const [
          totalEnrollments,
          activeEnrollments,
          completedEnrollments,
          sentCount,
          repliedCount,
          bouncedCount,
          optedOutCount
        ] = await Promise.all([
          Enrollment.countDocuments({ campaignId: camp._id }),
          Enrollment.countDocuments({ campaignId: camp._id, status: 'active' }),
          Enrollment.countDocuments({ campaignId: camp._id, status: 'completed' }),
          SendLog.countDocuments({ campaignId: camp._id, error: null }),
          Enrollment.countDocuments({ campaignId: camp._id, status: 'replied' }),
          Enrollment.countDocuments({ campaignId: camp._id, status: 'bounced' }),
          Enrollment.countDocuments({ campaignId: camp._id, status: 'opted_out' })
        ]);

        return {
          ...camp,
          metrics: {
            totalContacts: camp.contactIds?.length || 0,
            totalEnrollments,
            activeEnrollments,
            completedEnrollments,
            sentCount,
            repliedCount,
            bouncedCount,
            optedOutCount
          }
        };
      })
    );

    const campaignIds = campaigns.map((c) => c._id);
    const [recentSends, recentEvents] = await Promise.all([
      SendLog.find({ campaignId: { $in: campaignIds }, error: null })
        .populate('contactId', 'email firstName company')
        .populate('mailboxId', 'address displayName')
        .populate('campaignId', 'name')
        .sort({ sentAt: -1 })
        .limit(50)
        .lean(),
      Event.find({ campaignId: { $in: campaignIds } })
        .populate('contactId', 'email firstName company')
        .populate('mailboxId', 'address displayName')
        .populate('campaignId', 'name')
        .sort({ createdAt: -1 })
        .limit(50)
        .lean()
    ]);

    res.json({
      campaigns: enriched,
      recentSends,
      recentEvents
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns
router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const { sequenceId, mailboxIds = [], contactIds = [] } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Campaign name is required.' });
    }
    if (!sequenceId) {
      return res.status(400).json({ error: 'Sequence selection is required.' });
    }

    const campaign = await Campaign.create({
      userId: req.user._id,
      name,
      sequenceId,
      mailboxIds,
      contactIds,
      status: 'draft'
    });

    res.status(201).json({ campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /campaigns/:id
router.get('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('sequenceId')
      .populate('mailboxIds')
      .lean();

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const [contacts, enrollments] = await Promise.all([
      Contact.find({ _id: { $in: campaign.contactIds }, userId: req.user._id }).lean(),
      Enrollment.find({ campaignId: campaign._id })
        .populate('contactId', 'email firstName company status verificationStatus')
        .populate('mailboxId', 'address displayName status')
        .sort({ updatedAt: -1 })
        .lean()
    ]);

    res.json({ campaign, contacts, enrollments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /campaigns/:id
router.put('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (req.body.name !== undefined) campaign.name = String(req.body.name).trim();
    if (req.body.sequenceId !== undefined) campaign.sequenceId = req.body.sequenceId;
    if (Array.isArray(req.body.mailboxIds)) campaign.mailboxIds = req.body.mailboxIds;
    if (Array.isArray(req.body.contactIds)) campaign.contactIds = req.body.contactIds;

    campaign.gateCheckPassed = false;
    await campaign.save();
    res.json({ campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns/:id/preview (row index) - Section 6 & 9
router.post('/:id/preview', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const [sequence, mailboxes, contacts, complianceConfig] = await Promise.all([
      Sequence.findOne({ _id: campaign.sequenceId, userId: req.user._id }).lean(),
      Mailbox.find({ _id: { $in: campaign.mailboxIds }, userId: req.user._id }).lean(),
      Contact.find({ _id: { $in: campaign.contactIds }, userId: req.user._id }).lean(),
      ComplianceConfig.findOne({ userId: req.user._id }).lean()
    ]);

    if (!sequence) {
      return res.status(400).json({ error: 'Sequence not found for this campaign.' });
    }
    if (!contacts.length) {
      return res.status(400).json({ error: 'No contacts in this campaign to preview.' });
    }

    const rowIndex = Math.min(
      Math.max(0, Number(req.body.rowIndex ?? 0)),
      contacts.length - 1
    );
    const contact = req.body.contactId
      ? contacts.find((c) => String(c._id) === String(req.body.contactId)) || contacts[rowIndex]
      : contacts[rowIndex];

    const mailbox = mailboxes[rowIndex % Math.max(1, mailboxes.length)] || {
      address: 'outreach@yourdomain.com',
      displayName: req.user.name || 'Sender'
    };

    const senderContext = buildSenderContextForMailbox(
      mailbox,
      complianceConfig,
      contact,
      campaign._id
    );

    const renderedSteps = (sequence.steps || []).map((step, idx) => {
      const rendered = renderStepEmail({
        step,
        contact,
        senderContext,
        appendFooterIfMissing: true
      });
      return {
        stepIndex: idx,
        delayDays: step.delayDays,
        from: `"${mailbox.displayName}" <${mailbox.address}>`,
        to: contact.email,
        subject: rendered.subject,
        body: rendered.body,
        missingVariables: rendered.missingVariables,
        headers: {
          'List-Unsubscribe': `<mailto:${mailbox.address}?subject=unsubscribe>, <${senderContext.unsubscribeUrl}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
        }
      };
    });

    res.json({
      rowIndex,
      totalRows: contacts.length,
      contact: {
        _id: contact._id,
        email: contact.email,
        firstName: contact.firstName,
        company: contact.company,
        country: contact.country,
        variables: contact.variables
      },
      mailbox: {
        address: mailbox.address,
        displayName: mailbox.displayName
      },
      steps: renderedSteps
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns/:id/test-send - Section 6 & 9
router.post('/:id/test-send', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const toEmail = String(req.body.toEmail || req.user.email).trim().toLowerCase();
    const rowIndex = Number(req.body.rowIndex ?? 0);
    const stepIndex = Number(req.body.stepIndex ?? 0);

    const [sequence, mailboxes, contacts, complianceConfig] = await Promise.all([
      Sequence.findOne({ _id: campaign.sequenceId, userId: req.user._id }).lean(),
      Mailbox.find({ _id: { $in: campaign.mailboxIds }, userId: req.user._id }).select('+encryptedCredentials'),
      Contact.find({ _id: { $in: campaign.contactIds }, userId: req.user._id }).lean(),
      ComplianceConfig.findOne({ userId: req.user._id }).lean()
    ]);

    if (!sequence || !sequence.steps?.[stepIndex]) {
      return res.status(400).json({ error: 'Selected sequence step not found.' });
    }
    const mailbox = mailboxes[0];
    if (!mailbox) {
      return res.status(400).json({ error: 'Assign at least one mailbox before sending a test.' });
    }

    const contact = contacts[rowIndex] || {
      email: toEmail,
      firstName: 'Test',
      company: 'ExampleCorp',
      variables: {
        custom_opener: 'This is a sample custom opener used for your test send.'
      }
    };

    const senderContext = buildSenderContextForMailbox(mailbox, complianceConfig, contact, campaign._id);
    const rendered = renderStepEmail({
      step: sequence.steps[stepIndex],
      contact,
      senderContext,
      appendFooterIfMissing: true
    });

    const result = await sendViaGmailApi({
      mailbox,
      toAddress: toEmail,
      subject: `[TEST] ${rendered.subject}`,
      textBody: rendered.body,
      unsubscribeHttpsUrl: senderContext.unsubscribeUrl
    });

    res.json({
      sent: true,
      toEmail,
      fromMailbox: mailbox.address,
      subject: `[TEST] ${rendered.subject}`,
      body: rendered.body,
      mode: result.mode,
      gmailMessageId: result.gmailMessageId,
      rfc822MessageId: result.rfc822MessageId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns/:id/gate-check - Section 6 & 9
router.post('/:id/gate-check', async (req, res) => {
  try {
    const report = await runCampaignGateCheck(req.params.id, req.user._id);
    res.json(report);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /campaigns/:id/start - Section 6 & 7
router.post('/:id/start', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Always run gate check right before starting
    const gateReport = await runCampaignGateCheck(campaign._id, req.user._id);
    if (!gateReport.passed) {
      return res.status(400).json({
        error: 'Pre-send gate check failed. Resolve all flagged issues before starting the campaign.',
        gateReport
      });
    }

    const activeMailboxes = await Mailbox.find({
      _id: { $in: campaign.mailboxIds },
      userId: req.user._id,
      status: 'active'
    }).lean();

    if (activeMailboxes.length === 0) {
      return res.status(400).json({ error: 'No active mailboxes available for this campaign.' });
    }

    const contacts = await Contact.find({
      _id: { $in: campaign.contactIds },
      userId: req.user._id,
      status: 'active'
    }).lean();

    // Create Enrollments with 30-second to 2-minute staggered pacing slots per mailbox
    let createdCount = 0;
    const mailboxNextTime = new Map();
    const now = Date.now();

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];
      const assignedMailbox = activeMailboxes[i % activeMailboxes.length];
      const mbKey = String(assignedMailbox._id);

      const prevTime = mailboxNextTime.get(mbKey) || now;
      const nextTime = i < activeMailboxes.length ? now : prevTime + getRandomPacingMs();
      mailboxNextTime.set(mbKey, nextTime);

      const existing = await Enrollment.findOne({
        campaignId: campaign._id,
        contactId: contact._id
      });

      if (!existing) {
        await Enrollment.create({
          userId: req.user._id,
          campaignId: campaign._id,
          contactId: contact._id,
          mailboxId: assignedMailbox._id,
          currentStep: 0,
          nextSendAt: new Date(nextTime),
          status: 'active'
        });
        createdCount += 1;
      }
    }

    campaign.status = 'running';
    campaign.startedAt = campaign.startedAt || new Date();
    await campaign.save();

    res.json({
      campaign,
      enrollmentsCreated: createdCount,
      gateReport
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns/:id/pause
router.post('/:id/pause', async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { status: 'paused' } },
      { new: true }
    );
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns/:id/resume
router.post('/:id/resume', async (req, res) => {
  try {
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { status: 'running' } },
      { new: true }
    );
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ campaign });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /campaigns/:id/stats - Section 6 & 12
router.get('/:id/stats', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('sequenceId', 'name steps sendWindow')
      .populate('mailboxIds', 'address displayName status dailyCap sentToday health')
      .lean();

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const [
      enrollments,
      sendLogs,
      events
    ] = await Promise.all([
      Enrollment.find({ campaignId: campaign._id })
        .populate('contactId', 'email firstName company country status')
        .populate('mailboxId', 'address displayName status')
        .lean(),
      SendLog.find({ campaignId: campaign._id })
        .populate('contactId', 'email firstName company')
        .populate('mailboxId', 'address')
        .sort({ sentAt: -1 })
        .limit(100)
        .lean(),
      Event.find({ campaignId: campaign._id })
        .populate('contactId', 'email firstName company')
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
    ]);

    const statusCounts = {
      active: 0,
      completed: 0,
      replied: 0,
      bounced: 0,
      opted_out: 0,
      paused: 0,
      failed: 0
    };

    for (const enr of enrollments) {
      statusCounts[enr.status] = (statusCounts[enr.status] || 0) + 1;
    }

    const totalEnrolled = enrollments.length;
    const uniqueContactsEmailed = new Set(sendLogs.filter((l) => !l.error).map((l) => String(l.contactId?._id || l.contactId))).size;
    const totalEmailsSent = sendLogs.filter((l) => !l.error).length;
    const denom = Math.max(uniqueContactsEmailed, totalEnrolled, 1);

    const replyRate = Number(((statusCounts.replied / denom) * 100).toFixed(2));
    const bounceRate = Number(((statusCounts.bounced / denom) * 100).toFixed(2));
    const optOutRate = Number(((statusCounts.opted_out / denom) * 100).toFixed(2));

    res.json({
      campaign,
      stats: {
        totalEnrolled,
        uniqueContactsEmailed,
        totalEmailsSent,
        ...statusCounts,
        replyRate,
        bounceRate,
        optOutRate
      },
      mailboxHealth: campaign.mailboxIds,
      enrollments,
      recentSends: sendLogs,
      recentEvents: events
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns/:id/process-now (Triggers immediate scheduler + sender pass for testing/demo)
router.post('/:id/process-now', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    // Optionally pull due times to now so queued enrollments can be dispatched in test/demo
    if (req.body.expediteDueTimes) {
      await Enrollment.updateMany(
        { campaignId: campaign._id, status: 'active' },
        { $set: { nextSendAt: new Date(Date.now() - 1000) } }
      );
    }

    const result = await runSchedulerTick({
      ignoreSendWindow: Boolean(req.body.ignoreSendWindow)
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /campaigns/:id/simulate-event (Simulate reply, OOO, bounce, or complaint for Go-Live Checklist verification)
router.post('/:id/simulate-event', async (req, res) => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.user._id });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { enrollmentId, eventType = 'reply', customText = '' } = req.body;
    const query = enrollmentId
      ? { _id: enrollmentId, campaignId: campaign._id }
      : { campaignId: campaign._id };

    const enrollment = await Enrollment.findOne(query)
      .populate('contactId')
      .populate('mailboxId');

    if (!enrollment) {
      return res.status(404).json({ error: 'No enrollment found in this campaign to simulate event on.' });
    }

    const contact = enrollment.contactId;
    const mailbox = enrollment.mailboxId;

    if (eventType === 'bounce') {
      const outcome = await processIncomingMessage({
        mailboxId: mailbox._id,
        threadId: enrollment.threadId,
        fromAddress: 'mailer-daemon@googlemail.com',
        subject: `Delivery Status Notification (Failure)`,
        bodyText: customText || `550 5.1.1 The email account that you tried to reach (${contact.email}) does not exist.`,
        failedRecipientEmail: contact.email
      });
      return res.json(outcome);
    }

    if (eventType === 'complaint') {
      const outcome = await processIncomingMessage({
        mailboxId: mailbox._id,
        threadId: enrollment.threadId,
        fromAddress: contact.email,
        subject: `Spam Complaint Notification`,
        bodyText: customText || `Recipient ${contact.email} reported message as spam.`,
        failedRecipientEmail: contact.email,
        isComplaint: true
      });
      return res.json(outcome);
    }

    if (eventType === 'auto_reply') {
      const outcome = await processIncomingMessage({
        mailboxId: mailbox._id,
        threadId: enrollment.threadId,
        fromAddress: contact.email,
        subject: `Automatic reply: Quick question about ${contact.company}`,
        bodyText: customText || `I am currently out of the office with limited access to email until next week.`,
        headers: { 'Auto-Submitted': 'auto-replied' }
      });
      return res.json(outcome);
    }

    if (eventType === 'opt_out_reply') {
      const outcome = await processIncomingMessage({
        mailboxId: mailbox._id,
        threadId: enrollment.threadId,
        fromAddress: contact.email,
        subject: `Re: Quick question about ${contact.company}`,
        bodyText: customText || `No thanks, please remove me from your list.`
      });
      return res.json(outcome);
    }

    // Default: positive/neutral reply
    const outcome = await processIncomingMessage({
      mailboxId: mailbox._id,
      threadId: enrollment.threadId,
      fromAddress: contact.email,
      subject: `Re: Quick question about ${contact.company}`,
      bodyText: customText || `Hi ${mailbox.displayName}, thanks for reaching out! Tuesday at 10am works for a quick 15-minute chat.`
    });

    res.json(outcome);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
