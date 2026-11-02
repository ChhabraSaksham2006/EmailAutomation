import { Router } from 'express';
import {
  HARD_LIMITS,
  DEFAULT_SEND_WINDOW,
  extractTemplateVariables,
  lintStepCopy,
  STARTER_PLAYBOOK_SEQUENCE
} from '@cold-outreach/shared';
import { Sequence } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

function enrichSequenceWithMetadata(seqObj) {
  const allVars = new Set();
  const requiredVars = new Set();

  const stepDiagnostics = (seqObj.steps || []).map((step, idx) => {
    const subVars = extractTemplateVariables(step.subjectTemplate);
    const bodyVars = extractTemplateVariables(step.bodyTemplate);
    subVars.allVariables.forEach((v) => allVars.add(v));
    bodyVars.allVariables.forEach((v) => allVars.add(v));
    subVars.requiredVariables.forEach((v) => requiredVars.add(v));
    bodyVars.requiredVariables.forEach((v) => requiredVars.add(v));

    const lint = lintStepCopy(step, idx);
    return {
      stepIndex: idx,
      ...lint
    };
  });

  return {
    ...seqObj,
    variables: {
      all: Array.from(allVars),
      required: Array.from(requiredVars)
    },
    stepDiagnostics
  };
}

// GET /sequences
router.get('/', async (req, res) => {
  try {
    const docs = await Sequence.find({ userId: req.user._id }).sort({ updatedAt: -1 });
    for (const doc of docs) {
      let modified = false;
      for (const st of doc.steps || []) {
        if (st.bodyTemplate && st.bodyTemplate.includes('{{custom_opener}}')) {
          st.bodyTemplate = st.bodyTemplate.replace(/\n*\{\{custom_opener\}\}\n*/g, '\n\n');
          modified = true;
        }
      }
      if (modified) {
        await doc.save();
      }
    }
    const sequences = docs.map((d) => enrichSequenceWithMetadata(d.toObject()));
    res.json({
      sequences,
      starterPlaybook: STARTER_PLAYBOOK_SEQUENCE
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sequences
router.post('/', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const steps = Array.isArray(req.body.steps) ? req.body.steps : [];

    if (!name) {
      return res.status(400).json({ error: 'Sequence name is required.' });
    }
    if (steps.length < 1 || steps.length > HARD_LIMITS.MAX_SEQUENCE_STEPS) {
      return res.status(400).json({
        error: `Sequence must have between 1 and ${HARD_LIMITS.MAX_SEQUENCE_STEPS} steps (Section 1).`
      });
    }

    // Validate copy rules on each step
    const lintErrors = [];
    steps.forEach((step, idx) => {
      const lint = lintStepCopy(step, idx);
      lint.errors.forEach((e) => lintErrors.push(`Step ${idx + 1}: ${e}`));
    });

    if (lintErrors.length > 0 && !req.body.allowDraftWithErrors) {
      return res.status(400).json({
        error: lintErrors.join(' '),
        lintErrors
      });
    }

    const sequence = await Sequence.create({
      userId: req.user._id,
      name,
      steps: steps.map((s, i) => ({
        delayDays: Number(s.delayDays ?? (i === 0 ? 0 : i * 4)),
        subjectTemplate: String(s.subjectTemplate || '').trim(),
        bodyTemplate: String(s.bodyTemplate || '')
      })),
      sendWindow: req.body.sendWindow || DEFAULT_SEND_WINDOW,
      stopRules: req.body.stopRules || { onReply: true, onBounce: true, onOptOut: true }
    });

    res.status(201).json({
      sequence: enrichSequenceWithMetadata(sequence.toObject())
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /sequences/:id
router.put('/:id', async (req, res) => {
  try {
    const sequence = await Sequence.findOne({ _id: req.params.id, userId: req.user._id });
    if (!sequence) {
      return res.status(404).json({ error: 'Sequence not found' });
    }

    if (req.body.name !== undefined) {
      sequence.name = String(req.body.name).trim();
    }

    if (Array.isArray(req.body.steps)) {
      if (req.body.steps.length < 1 || req.body.steps.length > HARD_LIMITS.MAX_SEQUENCE_STEPS) {
        return res.status(400).json({
          error: `Sequence must have between 1 and ${HARD_LIMITS.MAX_SEQUENCE_STEPS} steps.`
        });
      }

      const lintErrors = [];
      req.body.steps.forEach((step, idx) => {
        const lint = lintStepCopy(step, idx);
        lint.errors.forEach((e) => lintErrors.push(`Step ${idx + 1}: ${e}`));
      });

      if (lintErrors.length > 0 && !req.body.allowDraftWithErrors) {
        return res.status(400).json({
          error: lintErrors.join(' '),
          lintErrors
        });
      }

      sequence.steps = req.body.steps.map((s, i) => ({
        delayDays: Number(s.delayDays ?? (i === 0 ? 0 : i * 4)),
        subjectTemplate: String(s.subjectTemplate || '').trim(),
        bodyTemplate: String(s.bodyTemplate || '')
      }));
    }

    if (req.body.sendWindow) {
      sequence.sendWindow = {
        days: Array.isArray(req.body.sendWindow.days) ? req.body.sendWindow.days : sequence.sendWindow.days,
        startHour: Number(req.body.sendWindow.startHour ?? sequence.sendWindow.startHour),
        endHour: Number(req.body.sendWindow.endHour ?? sequence.sendWindow.endHour)
      };
    }

    if (req.body.stopRules) {
      sequence.stopRules = {
        onReply: Boolean(req.body.stopRules.onReply ?? true),
        onBounce: Boolean(req.body.stopRules.onBounce ?? true),
        onOptOut: Boolean(req.body.stopRules.onOptOut ?? true)
      };
    }

    await sequence.save();
    res.json({ sequence: enrichSequenceWithMetadata(sequence.toObject()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sequences/:id
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Sequence.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!deleted) {
      return res.status(404).json({ error: 'Sequence not found' });
    }
    res.json({ deleted: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
