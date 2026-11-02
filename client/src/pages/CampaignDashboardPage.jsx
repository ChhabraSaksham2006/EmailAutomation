import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  Send,
  Play,
  Pause,
  Plus,
  Search,
  MessageSquare,
  AlertTriangle,
  Users,
  CheckCircle2,
  Clock,
  RefreshCw
} from 'lucide-react';
import { apiFetch } from '../api.js';
import {
  PageHeader,
  MetricCard,
  StatusBadge,
  MailboxCard,
  ActivityTimeline,
  EmptyState,
  LoadingSkeleton,
  useToast
} from '../components/ui.jsx';

export default function CampaignDashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState(searchParams.get('id') || '');
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enrollmentSearch, setEnrollmentSearch] = useState('');
  const [enrollmentStatusFilter, setEnrollmentStatusFilter] = useState('all');

  const loadCampaignList = async () => {
    try {
      const data = await apiFetch('/campaigns');
      const list = data.campaigns || [];
      setCampaigns(list);
      const current = searchParams.get('id') || selectedId || list[0]?._id || '';
      if (current) {
        setSelectedId(current);
        await loadStats(current);
      } else {
        setLoading(false);
      }
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const loadStats = async (id) => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const statsData = await apiFetch(`/campaigns/${id}/stats`);
      setDashboard(statsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCampaignList();
  }, []);

  const handleSelectCampaign = (id) => {
    setSelectedId(id);
    setSearchParams({ id });
    loadStats(id);
  };

  const handlePauseResume = async () => {
    if (!dashboard?.campaign) return;
    const isRunning = dashboard.campaign.status === 'running';
    try {
      await apiFetch(`/campaigns/${dashboard.campaign._id}/${isRunning ? 'pause' : 'resume'}`, {
        method: 'POST'
      });
      addToast(`Campaign ${isRunning ? 'paused' : 'resumed'}.`);
      await loadStats(dashboard.campaign._id);
      await loadCampaignList();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const filteredEnrollments = useMemo(() => {
    const list = dashboard?.enrollments || [];
    const q = enrollmentSearch.trim().toLowerCase();
    return list.filter((enr) => {
      if (enrollmentStatusFilter !== 'all' && enr.status !== enrollmentStatusFilter) return false;
      if (!q) return true;
      return (
        enr.contactId?.email?.toLowerCase().includes(q) ||
        enr.contactId?.firstName?.toLowerCase().includes(q) ||
        enr.contactId?.company?.toLowerCase().includes(q)
      );
    });
  }, [dashboard, enrollmentSearch, enrollmentStatusFilter]);

  const timelineItems = useMemo(() => {
    if (!dashboard) return [];
    const items = [];
    for (const s of (dashboard.recentSends || []).slice(0, 12)) {
      items.push({
        id: `s-${s._id}`,
        type: 'send',
        timestamp: new Date(s.sentAt).getTime(),
        timeLabel: new Date(s.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        title: `Step ${(s.step || 0) + 1} sent to ${s.contactId?.firstName || s.contactId?.email || 'contact'}`,
        subtitle: s.subject
      });
    }
    for (const ev of (dashboard.recentEvents || []).slice(0, 12)) {
      items.push({
        id: `e-${ev._id}`,
        type: ev.type === 'reply' ? 'reply' : 'bounce',
        timestamp: new Date(ev.createdAt).getTime(),
        timeLabel: new Date(ev.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        title: `${ev.type.toUpperCase()} — ${ev.contactId?.email || ev.fromAddress || ''}`,
        subtitle: ev.subject || ev.snippet || ''
      });
    }
    return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
  }, [dashboard]);

  const completionPct = useMemo(() => {
    if (!dashboard?.stats?.totalEnrolled) return 0;
    const finished =
      (dashboard.stats.completed || 0) +
      (dashboard.stats.replied || 0) +
      (dashboard.stats.bounced || 0) +
      (dashboard.stats.opted_out || 0);
    return Math.min(100, Math.round((finished / dashboard.stats.totalEnrolled) * 100));
  }, [dashboard]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaigns"
        subtitle="Manage active sequences, track prospect enrollment progress, and monitor deliverability."
        actions={
          <>
            {campaigns.length > 0 && (
              <select
                value={selectedId}
                onChange={(e) => handleSelectCampaign(e.target.value)}
                className="saas-select !w-auto min-w-[220px]"
              >
                {campaigns.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name} ({c.status.toUpperCase()})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => selectedId && loadStats(selectedId)}
              className="saas-btn-secondary !px-2.5"
              title="Refresh campaign"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/campaign-wizard')}
              className="saas-btn-accent"
            >
              <Plus className="w-4 h-4" />
              New Campaign
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
        <LoadingSkeleton cards={4} />
      ) : !dashboard ? (
        <EmptyState
          icon={Send}
          title="No campaigns created yet"
          description="Launch your first outreach campaign with automated 30s–2m human-paced sending."
          action={
            <button
              type="button"
              onClick={() => navigate('/campaign-wizard')}
              className="saas-btn-accent"
            >
              <Plus className="w-4 h-4" />
              Create First Campaign
            </button>
          }
        />
      ) : (
        <>
          {/* Campaign Summary & Progress Banner */}
          <div className="saas-card p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {dashboard.campaign.name}
                  </h2>
                  <StatusBadge status={dashboard.campaign.status} />
                </div>
                <p className="text-xs text-slate-500">
                  Sequence: <strong className="text-slate-700">{dashboard.campaign.sequenceId?.name || '—'}</strong> ·{' '}
                  Pacing: <strong className="text-slate-700">30s–2m random gap</strong> ·{' '}
                  Enrolled: <strong className="text-slate-700">{dashboard.stats.totalEnrolled} prospects</strong>
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                {(dashboard.campaign.status === 'running' ||
                  dashboard.campaign.status === 'paused') && (
                  <button
                    type="button"
                    onClick={handlePauseResume}
                    className={
                      dashboard.campaign.status === 'running'
                        ? 'saas-btn-secondary'
                        : 'saas-btn-accent'
                    }
                  >
                    {dashboard.campaign.status === 'running' ? (
                      <>
                        <Pause className="w-4 h-4 text-amber-600" />
                        Pause Campaign
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4" />
                        Resume Campaign
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Sending Progress Bar */}
            <div className="pt-2 border-t border-slate-100 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 font-medium">Sequence Completion Progress</span>
                <span className="font-mono font-semibold text-slate-800">{completionPct}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                  style={{ width: `${completionPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* KPI Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard
              label="Emails Sent"
              value={dashboard.stats.totalEmailsSent}
              subtext={`${dashboard.stats.uniqueContactsEmailed} unique prospects`}
              icon={Send}
            />
            <MetricCard
              label="Replies"
              value={`${dashboard.stats.replied} (${dashboard.stats.replyRate}%)`}
              subtext="Auto-stopped on reply"
              benchmark="2–8%"
              icon={MessageSquare}
              status={dashboard.stats.replyRate >= 2 ? 'positive' : 'neutral'}
            />
            <MetricCard
              label="Bounces"
              value={`${dashboard.stats.bounced} (${dashboard.stats.bounceRate}%)`}
              subtext="Auto-pause at 3%"
              benchmark="<2%"
              icon={AlertTriangle}
              status={dashboard.stats.bounceRate >= 3 ? 'danger' : dashboard.stats.bounceRate >= 2 ? 'warning' : 'neutral'}
            />
            <MetricCard
              label="Active in Queue"
              value={dashboard.stats.active}
              subtext="Awaiting next step"
              icon={Clock}
            />
            <MetricCard
              label="Completed"
              value={dashboard.stats.completed}
              subtext={`${dashboard.stats.opted_out} opted out`}
              icon={CheckCircle2}
              status="positive"
            />
          </div>

          {/* Enrollments Table & Activity Feed */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 saas-card overflow-hidden flex flex-col">
              <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Prospect Enrollments ({filteredEnrollments.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Individual recipient status and next scheduled send slot.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={enrollmentSearch}
                      onChange={(e) => setEnrollmentSearch(e.target.value)}
                      placeholder="Filter prospects..."
                      className="saas-input !pl-8 !py-1.5 !text-xs w-44"
                    />
                  </div>
                  <select
                    value={enrollmentStatusFilter}
                    onChange={(e) => setEnrollmentStatusFilter(e.target.value)}
                    className="saas-select !w-auto !py-1.5 !text-xs"
                  >
                    <option value="all">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="replied">Replied</option>
                    <option value="completed">Completed</option>
                    <option value="bounced">Bounced</option>
                    <option value="opted_out">Opted Out</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto max-h-[460px] overflow-y-auto divide-y divide-slate-100">
                <table className="min-w-full divide-y divide-slate-100 text-xs">
                  <thead className="bg-slate-50/90 text-[11px] font-semibold uppercase tracking-wider text-slate-500 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left">Prospect</th>
                      <th className="px-4 py-3 text-left">Step</th>
                      <th className="px-4 py-3 text-left">Status</th>
                      <th className="px-4 py-3 text-left">Next Send Slot</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredEnrollments.map((enr) => (
                      <tr key={enr._id} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-900">
                            {enr.contactId?.firstName || '—'}{' '}
                            <span className="text-slate-400 font-normal">
                              · {enr.contactId?.company || '—'}
                            </span>
                          </div>
                          <div className="font-mono text-slate-500 mt-0.5">
                            {enr.contactId?.email}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-700">
                          Step {Math.min((enr.currentStep || 0) + 1, 3)}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={enr.status} size="xs" />
                        </td>
                        <td className="px-4 py-3 text-slate-500 font-mono">
                          {enr.status === 'active' && enr.nextSendAt
                            ? new Date(enr.nextSendAt).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit'
                              })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right Column: Assigned Mailboxes & Live Activity */}
            <div className="lg:col-span-4 space-y-6">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-900">Assigned Mailboxes</h3>
                {(dashboard.mailboxHealth || []).map((mb) => (
                  <MailboxCard key={mb._id} mailbox={mb} compact={true} />
                ))}
              </div>

              <div className="saas-card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">
                  Campaign Activity Log
                </h3>
                <ActivityTimeline items={timelineItems} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
