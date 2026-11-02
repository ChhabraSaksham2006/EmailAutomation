import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Eye,
  Send,
  Play,
  ChevronLeft,
  ChevronRight,
  Search
} from 'lucide-react';
import { apiFetch } from '../api.js';
import {
  PageHeader,
  StatusBadge,
  useToast
} from '../components/ui.jsx';

export default function CampaignWizardPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [sequences, setSequences] = useState([]);
  const [mailboxes, setMailboxes] = useState([]);
  const [contacts, setContacts] = useState([]);

  const [name, setName] = useState('Q4 B2B Executive Outreach');
  const [selectedSequenceId, setSelectedSequenceId] = useState('');
  const [selectedMailboxIds, setSelectedMailboxIds] = useState([]);
  const [selectedContactIds, setSelectedContactIds] = useState([]);
  const [contactSearch, setContactSearch] = useState('');

  const [campaign, setCampaign] = useState(null);
  const [gateReport, setGateReport] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewRowIndex, setPreviewRowIndex] = useState(0);
  const [testEmail, setTestEmail] = useState('');
  const [testSendResult, setTestSendResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      apiFetch('/sequences'),
      apiFetch('/mailboxes'),
      apiFetch('/contacts'),
      apiFetch('/auth/me')
    ])
      .then(([seqRes, mbRes, ctRes, meRes]) => {
        const seqs = seqRes.sequences || [];
        const mbs = mbRes.mailboxes || [];
        const cts = ctRes.contacts || [];
        setSequences(seqs);
        setMailboxes(mbs);
        setContacts(cts);
        if (seqs[0]) setSelectedSequenceId(seqs[0]._id);
        setSelectedMailboxIds(mbs.filter((m) => m.status === 'active').map((m) => m._id));
        setSelectedContactIds(cts.filter((c) => c.status === 'active').map((c) => c._id));
        if (meRes.user?.email) setTestEmail(meRes.user.email);
      })
      .catch((err) => setError(err.message));
  }, []);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.email?.toLowerCase().includes(q) ||
        c.firstName?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q)
    );
  }, [contacts, contactSearch]);

  const ensureCampaignDraft = async () => {
    if (campaign?._id) {
      const updated = await apiFetch(`/campaigns/${campaign._id}`, {
        method: 'PUT',
        body: {
          name,
          sequenceId: selectedSequenceId,
          mailboxIds: selectedMailboxIds,
          contactIds: selectedContactIds
        }
      });
      setCampaign(updated.campaign);
      return updated.campaign;
    } else {
      const created = await apiFetch('/campaigns', {
        method: 'POST',
        body: {
          name,
          sequenceId: selectedSequenceId,
          mailboxIds: selectedMailboxIds,
          contactIds: selectedContactIds
        }
      });
      setCampaign(created.campaign);
      return created.campaign;
    }
  };

  const handleRunGateCheck = async () => {
    setBusy(true);
    setError('');
    try {
      const draft = await ensureCampaignDraft();
      const report = await apiFetch(`/campaigns/${draft._id}/gate-check`, {
        method: 'POST'
      });
      setGateReport(report);
      if (report.passed) {
        addToast('Campaign readiness check passed.');
      } else {
        addToast('Readiness check found items needing attention.', 'warning');
      }
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleLoadPreview = async (rowIndex = 0) => {
    setBusy(true);
    setError('');
    try {
      const draft = await ensureCampaignDraft();
      const prev = await apiFetch(`/campaigns/${draft._id}/preview`, {
        method: 'POST',
        body: { rowIndex }
      });
      setPreviewRowIndex(prev.rowIndex);
      setPreviewData(prev);
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleTestSend = async () => {
    setBusy(true);
    setError('');
    setTestSendResult(null);
    try {
      const draft = await ensureCampaignDraft();
      const res = await apiFetch(`/campaigns/${draft._id}/test-send`, {
        method: 'POST',
        body: {
          toEmail: testEmail,
          rowIndex: previewRowIndex,
          stepIndex: 0
        }
      });
      setTestSendResult(res);
      addToast(`Test email sent to ${res.toEmail}`);
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleStartCampaign = async () => {
    setBusy(true);
    setError('');
    try {
      const draft = await ensureCampaignDraft();
      await apiFetch(`/campaigns/${draft._id}/start`, {
        method: 'POST'
      });
      addToast('Campaign launched!');
      navigate(`/campaigns?id=${draft._id}`);
    } catch (err) {
      setError(err.message);
      if (err.payload?.gateReport) {
        setGateReport(err.payload.gateReport);
      }
      addToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const toggleMailbox = (id) => {
    setSelectedMailboxIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleContact = (id) => {
    setSelectedContactIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create New Campaign"
        subtitle="Select your sequence, sending mailbox, and target contacts, then verify readiness before launch."
      />

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {/* Campaign Setup Card */}
      <div className="saas-card p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Campaign Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="saas-input"
              placeholder="e.g. Q4 Enterprise Advisory Outreach"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Outreach Sequence
            </label>
            <select
              value={selectedSequenceId}
              onChange={(e) => setSelectedSequenceId(e.target.value)}
              className="saas-select"
            >
              <option value="">-- Choose Sequence --</option>
              {sequences.map((s) => (
                <option key={s._id} value={s._id}>
                  {s.name} ({s.steps?.length || 0} steps)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Mailboxes Selection */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-700">
            Sending Mailboxes ({selectedMailboxIds.length} selected)
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {mailboxes.map((mb) => {
              const checked = selectedMailboxIds.includes(mb._id);
              return (
                <label
                  key={mb._id}
                  className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer transition-colors text-xs ${
                    checked
                      ? 'border-emerald-500 bg-emerald-50/30'
                      : 'border-slate-200/90 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleMailbox(mb._id)}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 truncate">
                        {mb.displayName}
                      </div>
                      <div className="text-slate-500 font-mono truncate">{mb.address}</div>
                    </div>
                  </div>
                  <StatusBadge
                    status={mb.status}
                    label={`${mb.sentToday}/${mb.dailyCap}`}
                    size="xs"
                  />
                </label>
              );
            })}
          </div>
        </div>

        {/* Target Contacts Selector */}
        <div className="space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <label className="text-xs font-medium text-slate-700">
              Target Contacts ({selectedContactIds.length} of {contacts.length} selected)
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Filter contacts..."
                  className="saas-input !pl-8 !py-1 !text-xs w-44"
                />
              </div>
              <button
                type="button"
                onClick={() => setSelectedContactIds(contacts.map((c) => c._id))}
                className="font-medium text-emerald-700 hover:underline"
              >
                Select All
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedContactIds(
                    contacts
                      .filter((c) => c.verificationStatus === 'valid' && c.status === 'active')
                      .map((c) => c._id)
                  )
                }
                className="font-medium text-emerald-700 hover:underline"
              >
                Select Valid & Active
              </button>
            </div>
          </div>

          <div className="max-h-56 overflow-y-auto border border-slate-200/90 rounded-xl divide-y divide-slate-100 bg-white">
            {filteredContacts.map((c) => {
              const checked = selectedContactIds.includes(c._id);
              return (
                <label
                  key={c._id}
                  className="flex items-center justify-between px-4 py-2.5 hover:bg-slate-50 cursor-pointer text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleContact(c._id)}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                    <span className="font-semibold text-slate-900 truncate">
                      {c.firstName || '—'}
                    </span>
                    <span className="text-slate-400 truncate">({c.company || '—'})</span>
                    <span className="font-mono text-slate-600 truncate">{c.email}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[11px]">
                      {c.country}
                    </span>
                    <StatusBadge status={c.verificationStatus} size="xs" />
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={handleRunGateCheck}
              className="saas-btn-primary"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              1. Check Campaign Readiness
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleLoadPreview(0)}
              className="saas-btn-secondary"
            >
              <Eye className="w-4 h-4" />
              2. Preview Emails
            </button>
          </div>

          <button
            type="button"
            disabled={busy || !gateReport?.passed}
            onClick={handleStartCampaign}
            className="saas-btn-accent"
          >
            <Play className="w-4 h-4" />
            Launch Campaign
          </button>
        </div>
      </div>

      {/* Readiness Report Panel */}
      {gateReport && (
        <div
          className={`saas-card p-5 space-y-4 border-l-4 ${
            gateReport.passed ? 'border-l-emerald-500' : 'border-l-amber-500'
          }`}
        >
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              {gateReport.passed ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-600" />
              )}
              <h2 className="text-base font-semibold text-slate-900">
                {gateReport.passed
                  ? 'Campaign Ready to Launch'
                  : 'Action Required Before Launching'}
              </h2>
            </div>
            <div className="text-xs text-slate-500">
              Eligible Contacts: <strong className="text-slate-900">{gateReport.summary.eligibleContacts}</strong> /{' '}
              {gateReport.summary.totalContacts}
            </div>
          </div>

          {(gateReport.sequenceErrors?.length > 0 || gateReport.mailboxIssues?.length > 0) && (
            <div className="space-y-1 text-xs text-rose-700 bg-rose-50/70 p-3.5 rounded-lg border border-rose-200">
              {[...gateReport.sequenceErrors, ...gateReport.mailboxIssues].map((issue, idx) => (
                <div key={idx}>• {issue}</div>
              ))}
            </div>
          )}

          {gateReport.rowFailures?.length > 0 && (
            <div className="rounded-xl border border-amber-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-amber-50 text-xs font-semibold text-amber-900">
                Contacts Requiring Attention ({gateReport.rowFailures.length})
              </div>
              <div className="divide-y divide-slate-100 max-h-52 overflow-y-auto text-xs bg-white">
                {gateReport.rowFailures.map((fail, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-4">
                    <div>
                      <span className="font-mono font-medium text-slate-800">
                        Row #{fail.rowIndex + 1}: {fail.email}
                      </span>{' '}
                      <span className="text-slate-400">({fail.country})</span>
                    </div>
                    <div className="text-rose-600 font-medium text-right">
                      {fail.reasons.join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Email Preview & Test Send Panel */}
      {previewData && (
        <div className="saas-card p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold text-slate-900">
                Email Preview (Contact {previewRowIndex + 1} of {previewData.totalRows})
              </h3>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={previewRowIndex <= 0}
                  onClick={() => handleLoadPreview(previewRowIndex - 1)}
                  className="saas-btn-secondary !p-1.5"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  disabled={previewRowIndex >= previewData.totalRows - 1}
                  onClick={() => handleLoadPreview(previewRowIndex + 1)}
                  className="saas-btn-secondary !p-1.5"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="your-email@company.com"
                className="saas-input !w-56 !py-1.5 !text-xs"
              />
              <button
                type="button"
                disabled={busy}
                onClick={handleTestSend}
                className="saas-btn-primary !py-1.5 !text-xs"
              >
                <Send className="w-3.5 h-3.5" />
                Send Test Email
              </button>
            </div>
          </div>

          {testSendResult && (
            <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              <strong>Test email sent:</strong> Delivered to{' '}
              <span className="font-mono">{testSendResult.toEmail}</span> from{' '}
              <span className="font-mono">{testSendResult.fromMailbox}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(previewData.steps || []).map((st) => (
              <div
                key={st.stepIndex}
                className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-2.5"
              >
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-900">
                    Step {st.stepIndex + 1} (Day {st.delayDays})
                  </span>
                  {st.missingVariables?.length > 0 ? (
                    <StatusBadge
                      status="bounced"
                      label={`Missing: ${st.missingVariables.join(', ')}`}
                      size="xs"
                    />
                  ) : (
                    <StatusBadge status="valid" label="Ready" size="xs" />
                  )}
                </div>
                <div className="text-xs text-slate-600 space-y-0.5">
                  <div>
                    <strong className="text-slate-800">From:</strong> {st.from}
                  </div>
                  <div>
                    <strong className="text-slate-800">To:</strong> {st.to}
                  </div>
                  <div>
                    <strong className="text-slate-800">Subject:</strong> {st.subject}
                  </div>
                </div>
                <pre className="text-xs text-slate-800 whitespace-pre-wrap font-sans bg-white p-3.5 rounded-lg border border-slate-200/80 leading-relaxed">
                  {st.body}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
