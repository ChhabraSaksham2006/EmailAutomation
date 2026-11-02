import React, { useState, useEffect, useMemo } from 'react';
import {
  Inbox,
  ThumbsUp,
  ThumbsDown,
  ShieldBan,
  AlertTriangle,
  Clock,
  Search,
  RefreshCw,
  Mail
} from 'lucide-react';
import { apiFetch } from '../api.js';
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  LoadingSkeleton,
  ConfirmationDialog,
  useToast
} from '../components/ui.jsx';

export default function RepliesInboxPage() {
  const { addToast } = useToast();

  const [replies, setReplies] = useState([]);
  const [selectedReply, setSelectedReply] = useState(null);
  const [filter, setFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [replyToSuppress, setReplyToSuppress] = useState(null);

  const loadReplies = async () => {
    setLoading(true);
    setError('');
    try {
      const qs =
        filter === 'opt_out'
          ? '?optOutFlagged=true'
          : filter !== 'all'
            ? `?interestedStatus=${filter}`
            : '';
      const data = await apiFetch(`/replies${qs}`);
      const list = data.replies || [];
      setReplies(list);
      if (list.length > 0 && !selectedReply) {
        setSelectedReply(list[0]);
      } else if (selectedReply) {
        const updated = list.find((r) => r._id === selectedReply._id);
        setSelectedReply(updated || list[0] || null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReplies();
  }, [filter]);

  const filteredReplies = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return replies;
    return replies.filter(
      (r) =>
        r.subject?.toLowerCase().includes(q) ||
        r.snippet?.toLowerCase().includes(q) ||
        r.fromAddress?.toLowerCase().includes(q) ||
        r.contactId?.firstName?.toLowerCase().includes(q) ||
        r.contactId?.company?.toLowerCase().includes(q)
    );
  }, [replies, searchQuery]);

  const handleMarkInterest = async (replyId, interestedStatus) => {
    try {
      await apiFetch(`/replies/${replyId}/interest`, {
        method: 'POST',
        body: { interestedStatus }
      });
      addToast(
        `Marked conversation as ${interestedStatus.replace(/_/g, ' ')}.`
      );
      await loadReplies();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleConfirmSuppress = async () => {
    if (!replyToSuppress) return;
    try {
      await apiFetch(`/replies/${replyToSuppress._id}/suppress`, {
        method: 'POST'
      });
      addToast('Contact added to global suppression list.');
      setReplyToSuppress(null);
      await loadReplies();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Replies Inbox"
        subtitle="Unified inbox for prospect responses. Sequences pause automatically as soon as a reply arrives."
        actions={
          <>
            <div className="inline-flex rounded-lg border border-slate-200/90 bg-white p-0.5 text-xs shadow-sm">
              {[
                { id: 'all', label: 'All' },
                { id: 'unreviewed', label: 'Unreviewed' },
                { id: 'interested', label: 'Interested' },
                { id: 'opt_out', label: 'Opt-Out Flagged' }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                    filter === tab.id
                      ? 'bg-[#0B1324] text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={loadReplies}
              className="saas-btn-secondary !px-2.5"
              title="Refresh inbox"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </>
        }
      />

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : replies.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="No replies in this view"
          description="Incoming prospect responses and out-of-office notifications will appear here automatically."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Conversation List */}
          <div className="lg:col-span-5 saas-card overflow-hidden flex flex-col">
            <div className="p-3.5 border-b border-slate-100">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search conversations..."
                  className="saas-input !pl-8 !py-1.5 !text-xs"
                />
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[600px] overflow-y-auto">
              {filteredReplies.map((rep) => {
                const active = selectedReply?._id === rep._id;
                const isUnread = rep.interestedStatus === 'unreviewed';

                return (
                  <button
                    key={rep._id}
                    type="button"
                    onClick={() => setSelectedReply(rep)}
                    className={`w-full text-left p-4 transition-colors space-y-1.5 ${
                      active
                        ? 'bg-[#0B1324] text-white'
                        : 'bg-white text-slate-900 hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                        )}
                        <span className="font-semibold text-xs sm:text-sm truncate">
                          {rep.contactId?.firstName || rep.fromAddress}
                          {rep.contactId?.company ? ` · ${rep.contactId.company}` : ''}
                        </span>
                      </div>
                      <StatusBadge
                        status={rep.interestedStatus}
                        size="xs"
                        showDot={false}
                      />
                    </div>

                    <div
                      className={`text-xs font-medium truncate ${
                        active ? 'text-slate-200' : 'text-slate-700'
                      }`}
                    >
                      {rep.subject}
                    </div>

                    <p
                      className={`text-xs line-clamp-2 ${
                        active ? 'text-slate-400' : 'text-slate-500'
                      }`}
                    >
                      {rep.snippet}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Reading Pane */}
          <div className="lg:col-span-7">
            {selectedReply && (
              <div className="saas-card p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-4 border-b border-slate-100">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-semibold text-slate-900">
                        {selectedReply.subject}
                      </h2>
                      <StatusBadge status={selectedReply.interestedStatus} size="xs" />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      From:{' '}
                      <strong className="font-mono text-slate-800">
                        {selectedReply.contactId?.email || selectedReply.fromAddress}
                      </strong>{' '}
                      · Campaign:{' '}
                      <strong className="text-slate-800">
                        {selectedReply.campaignId?.name || '—'}
                      </strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleMarkInterest(selectedReply._id, 'interested')}
                      className="saas-btn-accent !px-3 !py-1.5 !text-xs"
                    >
                      <ThumbsUp className="w-3.5 h-3.5" />
                      Interested
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMarkInterest(selectedReply._id, 'not_interested')}
                      className="saas-btn-secondary !px-3 !py-1.5 !text-xs"
                    >
                      <ThumbsDown className="w-3.5 h-3.5" />
                      Not Interested
                    </button>
                    <button
                      type="button"
                      onClick={() => setReplyToSuppress(selectedReply)}
                      className="saas-btn-danger !px-3 !py-1.5 !text-xs"
                    >
                      <ShieldBan className="w-3.5 h-3.5" />
                      Suppress
                    </button>
                  </div>
                </div>

                {selectedReply.optOutFlagged && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>
                      <strong>Opt-out keyword detected:</strong> Follow-ups for this contact are paused. Click <strong>Suppress</strong> to add them permanently to the suppression list.
                    </span>
                  </div>
                )}

                {selectedReply.type === 'auto_reply' && (
                  <div className="p-3.5 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>
                      <strong>Out-of-Office Auto-Reply:</strong> Next sequence step automatically delayed by 3 days.
                    </span>
                  </div>
                )}

                {/* Previous Outbound Steps */}
                {selectedReply.sentHistory?.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Previous Outbound Messages
                    </div>
                    {selectedReply.sentHistory.map((log) => (
                      <div
                        key={log._id}
                        className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 text-xs flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span className="font-semibold text-slate-700">
                            Step {log.step + 1}:
                          </span>
                          <span className="text-slate-600 truncate">{log.subject}</span>
                        </div>
                        <span className="text-slate-400 shrink-0">
                          {new Date(log.sentAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Incoming Message Body */}
                <div className="p-5 rounded-xl bg-emerald-50/30 border border-emerald-200/80 space-y-2.5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-semibold text-slate-900">
                      {selectedReply.contactId?.firstName || selectedReply.fromAddress} wrote:
                    </span>
                    <span>{new Date(selectedReply.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
                    {selectedReply.snippet}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(replyToSuppress)}
        title="Add Contact to Global Suppression List"
        description={`This will permanently block future emails to ${
          replyToSuppress?.contactId?.email || replyToSuppress?.fromAddress
        } across all campaigns.`}
        confirmLabel="Suppress Contact"
        onConfirm={handleConfirmSuppress}
        onCancel={() => setReplyToSuppress(null)}
      />
    </div>
  );
}
