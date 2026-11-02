import React, { useState, useEffect } from 'react';
import {
  GitBranch,
  Plus,
  AlertTriangle,
  Sparkles,
  Save,
  Trash2,
  Clock,
  Copy,
  Check
} from 'lucide-react';
import { apiFetch } from '../api.js';
import {
  PageHeader,
  EmptyState,
  LoadingSkeleton,
  useToast
} from '../components/ui.jsx';

const VARIABLE_PILLS = [
  '{{default first_name "there"}}',
  '{{company}}',
  '{{default target_role_plural "B2B teams"}}',
  '{{default one_line_value "streamlining outbound operations"}}',
  '{{sender_name}}',
  '{{sender_title}}',
  '{{sender_company}}',
  '{{sender_address}}'
];

const WEEKDAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' }
];

export default function SequencesPage() {
  const { addToast } = useToast();
  const [sequences, setSequences] = useState([]);
  const [starterPlaybook, setStarterPlaybook] = useState(null);
  const [selectedSeq, setSelectedSeq] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedToken, setCopiedToken] = useState('');

  const loadSequences = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/sequences');
      setSequences(data.sequences || []);
      setStarterPlaybook(data.starterPlaybook || null);
      if (data.sequences?.length > 0 && !selectedSeq) {
        setSelectedSeq(data.sequences[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSequences();
  }, []);

  const handleNewFromPlaybook = () => {
    const base = starterPlaybook || {
      name: 'New 3-Step Outreach Sequence',
      sendWindow: { days: [2, 3, 4], startHour: 9, endHour: 11 },
      steps: [
        {
          delayDays: 0,
          subjectTemplate: 'Quick question about {{company}}',
          bodyTemplate:
            'Hi {{default first_name "there"}},\n\nI help {{default target_role_plural "B2B teams"}} with {{default one_line_value "streamlining outbound operations"}}.\n\nWould a short chat be worth it for {{company}}?\n\nIf not, just reply "no thanks" and I won\'t follow up.\n\n{{sender_name}}, {{sender_company}}\n{{sender_address}}'
        }
      ]
    };
    setSelectedSeq({
      ...base,
      _id: null,
      name: `${base.name} (${sequences.length + 1})`
    });
  };

  const handleSaveSequence = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (selectedSeq._id) {
        const res = await apiFetch(`/sequences/${selectedSeq._id}`, {
          method: 'PUT',
          body: selectedSeq
        });
        setSelectedSeq(res.sequence);
      } else {
        const res = await apiFetch('/sequences', {
          method: 'POST',
          body: selectedSeq
        });
        setSelectedSeq(res.sequence);
      }
      addToast('Sequence saved and validated.');
      loadSequences();
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    }
  };

  const handleStepChange = (idx, field, value) => {
    const updatedSteps = [...(selectedSeq.steps || [])];
    updatedSteps[idx] = { ...updatedSteps[idx], [field]: value };
    setSelectedSeq({ ...selectedSeq, steps: updatedSteps });
  };

  const handleAddStep = () => {
    const current = selectedSeq.steps || [];
    if (current.length >= 3) return;
    const nextIdx = current.length;
    setSelectedSeq({
      ...selectedSeq,
      steps: [
        ...current,
        {
          delayDays: nextIdx === 1 ? 4 : 9,
          subjectTemplate: 'Re: Quick question about {{company}}',
          bodyTemplate:
            'Hi {{default first_name "there"}}, following up in case my note got buried. Happy to share details by email if easier. A quick "not now" is welcome too.\n\n{{sender_name}} {{sender_company}}\n{{sender_address}}'
        }
      ]
    });
  };

  const handleRemoveStep = (idx) => {
    if ((selectedSeq.steps || []).length <= 1) return;
    setSelectedSeq({
      ...selectedSeq,
      steps: selectedSeq.steps.filter((_, i) => i !== idx)
    });
  };

  const toggleSendDay = (dayNum) => {
    const currentDays = selectedSeq.sendWindow?.days || [2, 3, 4];
    const nextDays = currentDays.includes(dayNum)
      ? currentDays.filter((d) => d !== dayNum)
      : [...currentDays, dayNum].sort();
    setSelectedSeq({
      ...selectedSeq,
      sendWindow: { ...(selectedSeq.sendWindow || {}), days: nextDays }
    });
  };

  const handleCopyToken = (token) => {
    navigator.clipboard?.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(''), 1500);
  };

  const renderLivePreview = (text = '') => {
    const sampleMap = {
      first_name: 'Sarah',
      company: 'LinearFlow',
      target_role_plural: 'VP Engineering leaders',
      one_line_value: 'eliminating flaky deployment bottlenecks',
      follow_up_angle: 'Happy to share a 2-sentence summary of how similar teams cut build queues.',
      topic: 'CI pipeline speed',
      sender_name: 'Rama Consultants',
      sender_title: 'Consultant',
      sender_company: 'Rama Consultants',
      sender_address: 'Nehru Park, SCO 1, S D Market Model Town, Yamuna Nagar, Haryana 135001'
    };

    return String(text).replace(
      /\{\{\s*(?:default\s+([a-zA-Z0-9_]+)\s+["']([^"']*)["']|([a-zA-Z0-9_]+))\s*\}\}/g,
      (_, defVar, fallback, directVar) => {
        const key = defVar || directVar;
        return sampleMap[key] || fallback || `[missing:${key}]`;
      }
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sequences"
        subtitle="Design multi-step plain-text workflows that automatically pause when a prospect replies."
        actions={
          <button
            type="button"
            onClick={handleNewFromPlaybook}
            className="saas-btn-accent"
          >
            <Plus className="w-4 h-4" />
            New Sequence
          </button>
        }
      />

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Sidebar List */}
        <div className="lg:col-span-3 space-y-2.5">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 px-1">
            Saved Sequences ({sequences.length})
          </div>
          {loading ? (
            <LoadingSkeleton rows={3} />
          ) : (
            sequences.map((seq) => {
              const active = selectedSeq?._id === seq._id;
              return (
                <button
                  key={seq._id}
                  type="button"
                  onClick={() => {
                    setSelectedSeq(seq);
                    setError('');
                  }}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    active
                      ? 'bg-[#0B1324] text-white border-[#0B1324] shadow-sm'
                      : 'bg-white text-slate-800 border-slate-200/90 hover:border-slate-300'
                  }`}
                >
                  <div className="font-semibold text-sm truncate">{seq.name}</div>
                  <div
                    className={`flex items-center gap-2 text-xs mt-1.5 ${
                      active ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    <span>{seq.steps?.length || 0} steps</span>
                    <span>·</span>
                    <span>
                      {seq.sendWindow?.startHour}:00–{seq.sendWindow?.endHour}:00 local
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Main Visual Sequence Builder */}
        <div className="lg:col-span-9">
          {!selectedSeq ? (
            <EmptyState
              icon={GitBranch}
              title="Select or create a sequence"
              description="Build a 1 to 3 step email workflow with personalized variables."
              action={
                <button
                  type="button"
                  onClick={handleNewFromPlaybook}
                  className="saas-btn-accent"
                >
                  <Plus className="w-4 h-4" />
                  Create Sequence
                </button>
              }
            />
          ) : (
            <form onSubmit={handleSaveSequence} className="space-y-6">
              {/* Top Sequence Settings Card */}
              <div className="saas-card p-5 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Sequence Name
                    </label>
                    <input
                      type="text"
                      required
                      value={selectedSeq.name}
                      onChange={(e) =>
                        setSelectedSeq({ ...selectedSeq, name: e.target.value })
                      }
                      className="saas-input"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Recipient Local Delivery Window
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex gap-1">
                        {WEEKDAYS.map((w) => {
                          const active = (selectedSeq.sendWindow?.days || [2, 3, 4]).includes(w.day);
                          return (
                            <button
                              key={w.day}
                              type="button"
                              onClick={() => toggleSendDay(w.day)}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                                active
                                  ? 'bg-[#0B1324] text-white border-[#0B1324]'
                                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              {w.label}
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-slate-600">
                        <Clock className="w-3.5 h-3.5 text-slate-400" />
                        <input
                          type="number"
                          min={0}
                          max={22}
                          value={selectedSeq.sendWindow?.startHour ?? 9}
                          onChange={(e) =>
                            setSelectedSeq({
                              ...selectedSeq,
                              sendWindow: {
                                ...selectedSeq.sendWindow,
                                startHour: Number(e.target.value)
                              }
                            })
                          }
                          className="w-14 px-2 py-1.5 border border-slate-200 rounded-lg text-center font-mono"
                        />
                        <span>to</span>
                        <input
                          type="number"
                          min={1}
                          max={23}
                          value={selectedSeq.sendWindow?.endHour ?? 11}
                          onChange={(e) =>
                            setSelectedSeq({
                              ...selectedSeq,
                              sendWindow: {
                                ...selectedSeq.sendWindow,
                                endHour: Number(e.target.value)
                              }
                            })
                          }
                          className="w-14 px-2 py-1.5 border border-slate-200 rounded-lg text-center font-mono"
                        />
                        <span className="text-slate-400">hrs</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Personalization Variables Bar */}
                <div className="pt-3 border-t border-slate-100">
                  <div className="text-xs font-medium text-slate-500 mb-2">
                    Personalization Tokens (Click to copy):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {VARIABLE_PILLS.map((token) => (
                      <button
                        key={token}
                        type="button"
                        onClick={() => handleCopyToken(token)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-50 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 text-slate-700 font-mono text-xs border border-slate-200/80 transition-colors"
                      >
                        {copiedToken === token ? (
                          <Check className="w-3 h-3 text-emerald-600" />
                        ) : (
                          <Copy className="w-3 h-3 text-slate-400" />
                        )}
                        {token}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Visual Step Workflow */}
              <div className="space-y-4">
                {(selectedSeq.steps || []).map((step, idx) => {
                  const words = String(step.bodyTemplate || '')
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean).length;
                  const hasFakeRe =
                    idx === 0 && /^(re|fwd):/i.test(String(step.subjectTemplate || '').trim());

                  return (
                    <div key={idx} className="relative">
                      {idx > 0 && (
                        <div className="flex items-center gap-2 py-1 pl-6 text-xs text-slate-400">
                          <div className="w-0.5 h-4 bg-slate-200" />
                          <span>Wait until Day {step.delayDays} if no reply</span>
                        </div>
                      )}

                      <div className="saas-card p-5 space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className="px-2.5 py-1 rounded-lg bg-[#0B1324] text-white text-xs font-semibold">
                              Step {idx + 1}
                            </span>
                            <div className="flex items-center gap-1.5 text-xs text-slate-600">
                              <span>Send on Day</span>
                              <input
                                type="number"
                                min={0}
                                max={30}
                                value={step.delayDays}
                                onChange={(e) =>
                                  handleStepChange(idx, 'delayDays', Number(e.target.value))
                                }
                                className="w-16 px-2 py-1 border border-slate-200 rounded-lg text-center font-mono font-semibold"
                              />
                              <span className="text-slate-400">
                                {idx === 0 ? '(Initial outreach)' : '(Follow-up in thread)'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <span
                              className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${
                                words >= 50 && words <= 120
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}
                            >
                              {words} words (target 50–120)
                            </span>
                            {(selectedSeq.steps || []).length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveStep(idx)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        {hasFakeRe && (
                          <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>Step 1 cannot start with a misleading &quot;Re:&quot; or &quot;Fwd:&quot; prefix.</span>
                          </div>
                        )}

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                          <div className="space-y-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                Subject Line
                              </label>
                              <input
                                type="text"
                                required
                                value={step.subjectTemplate}
                                onChange={(e) =>
                                  handleStepChange(idx, 'subjectTemplate', e.target.value)
                                }
                                className="saas-input font-mono !text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                Email Body
                              </label>
                              <textarea
                                rows={8}
                                required
                                value={step.bodyTemplate}
                                onChange={(e) =>
                                  handleStepChange(idx, 'bodyTemplate', e.target.value)
                                }
                                className="saas-input font-mono !text-xs leading-relaxed"
                              />
                            </div>
                          </div>

                          {/* Live Email Preview */}
                          <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 flex flex-col justify-between">
                            <div>
                              <div className="flex items-center justify-between text-xs text-slate-500 pb-2.5 mb-3 border-b border-slate-200/80">
                                <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                                  Live Prospect Preview
                                </span>
                                <span className="text-[11px] text-slate-400">Sample Data</span>
                              </div>
                              <div className="text-xs font-semibold text-slate-900 mb-2.5">
                                Subject: {renderLivePreview(step.subjectTemplate)}
                              </div>
                              <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed bg-white p-3.5 rounded-lg border border-slate-200/70">
                                {renderLivePreview(step.bodyTemplate)}
                              </pre>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                {(selectedSeq.steps || []).length < 3 ? (
                  <button
                    type="button"
                    onClick={handleAddStep}
                    className="saas-btn-secondary"
                  >
                    <Plus className="w-4 h-4" />
                    Add Follow-Up Step ({(selectedSeq.steps || []).length}/3)
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">
                    Maximum of 3 steps reached.
                  </span>
                )}

                <button type="submit" className="saas-btn-accent">
                  <Save className="w-4 h-4" />
                  Save Sequence
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
