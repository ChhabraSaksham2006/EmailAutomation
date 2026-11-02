import { Router } from 'express';
import { Event, SendLog } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { addSuppression } from '../services/suppressionService.js';
import { pollAllMailboxesForRepliesAndBounces } from '../services/sendingEngineService.js';

const router = Router();
router.use(requireAuth);

// GET /replies - Section 6 & 12
router.get('/', async (req, res) => {
  try {
    const query = {
      userId: req.user._id,
      type: { $in: ['reply', 'auto_reply'] }
    };

    if (req.query.interestedStatus) {
      query.interestedStatus = req.query.interestedStatus;
    }
    if (req.query.optOutFlagged === 'true') {
      query.optOutFlagged = true;
    }

    const replies = await Event.find(query)
      .populate('contactId', 'email firstName company title country status')
      .populate('campaignId', 'name')
      .populate('mailboxId', 'address displayName')
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();

    // Attach sent thread history for thread view (Section 12)
    const enriched = await Promise.all(
      replies.map(async (reply) => {
        const sentHistory = reply.enrollmentId
          ? await SendLog.find({ enrollmentId: reply.enrollmentId }).sort({ step: 1 }).lean()
          : [];
        return {
          ...reply,
          sentHistory
        };
      })
    );

    res.json({ replies: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /replies/:id/interest (Mark interested / not_interested / archived)
router.post('/:id/interest', async (req, res) => {
  try {
    const { interestedStatus } = req.body;
    if (!['unreviewed', 'interested', 'not_interested', 'archived'].includes(interestedStatus)) {
      return res.status(400).json({ error: 'Invalid interestedStatus value' });
    }

    const event = await Event.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: { interestedStatus } },
      { new: true }
    )
      .populate('contactId', 'email firstName company status')
      .populate('campaignId', 'name');

    if (!event) {
      return res.status(404).json({ error: 'Reply event not found' });
    }

    res.json({ reply: event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /replies/:id/suppress (One-click suppress from Replies Inbox - Section 8 & 12)
router.post('/:id/suppress', async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, userId: req.user._id })
      .populate('contactId');

    if (!event) {
      return res.status(404).json({ error: 'Reply event not found' });
    }

    const emailToSuppress = event.contactId?.email || event.fromAddress;
    if (!emailToSuppress) {
      return res.status(400).json({ error: 'No email address associated with this reply' });
    }

    const suppression = await addSuppression({
      email: emailToSuppress,
      reason: 'opt_out',
      notes: `One-click suppressed from Replies Inbox (Reply: "${event.subject}")`
    });

    event.interestedStatus = 'not_interested';
    event.optOutFlagged = false;
    await event.save();

    res.json({
      suppressed: true,
      suppression,
      reply: event
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /replies/poll-now (Trigger immediate inbox poll across active mailboxes)
router.post('/poll-now', async (_req, res) => {
  try {
    const results = await pollAllMailboxesForRepliesAndBounces();
    res.json({ polled: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
