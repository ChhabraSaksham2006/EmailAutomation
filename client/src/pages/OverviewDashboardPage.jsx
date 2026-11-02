import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Send,
  MessageSquare,
  AlertTriangle,
  UserMinus,
  Users,
  Plus,
  Search,
  ArrowUpDown,
  Play,
  Pause,
  ExternalLink,
  Calendar,
  RefreshCw,
  Mail
} from 'lucide-react';
import { apiFetch } from '../api.js';
import {
  MetricCard,
  StatusBadge,
  MailboxCard,
  ActivityTimeline,
  EmptyState,
  LoadingSkeleton,
  useToast
} from '../components/ui.jsx';
import { AnalyticsChart } from '../components/AnalyticsChart.jsx';

function getTimeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatRelativeTime(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function OverviewDashboardPage({ user }) {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [campaigns, setCampaigns] = useState([]);
  const [mailboxes, setMailboxes] = useState([]);
  const [recentSends, setRecentSends] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Controls
  const [dateRange, setDateRange] = useState('14d'); // '7d' | '14d' | '30d' | 'all'
  const [secondaryChartMode, setSecondaryChartMode] = useState('trends'); // 'trends' | 'campaigns'
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 6;

  const loadOverview = async () => {
    setLoading(true);
    setError('');
    try {
      const [campData, mbData] = await Promise.all([
        apiFetch('/campaigns'),
        apiFetch('/mailboxes')
      ]);
      setCampaigns(campData.campaigns || []);
      setRecentSends(campData.recentSends || []);
      setRecentEvents(campData.recentEvents || []);
      setMailboxes(mbData.mailboxes || []);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const handleToggleCampaignStatus = async (camp) => {
    const isRunning = camp.status === 'running';
    try {
      await apiFetch(`/campaigns/${camp._id}/${isRunning ? 'pause' : 'resume'}`, {
        method: 'POST'
      });
      addToast(`Campaign "${camp.name}" ${isRunning ? 'paused' : 'resumed'}.`);
      loadOverview();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  // Compute aggregate KPI metrics from actual backend data
  const kpis = useMemo(() => {
    let totalSent = 0;
    let totalReplies = 0;
    let totalBounces = 0;
    let totalOptOuts = 0;
    let activeProspects = 0;
    let totalEnrollments = 0;

    for (const c of campaigns) {
      const m = c.metrics || {};
      totalSent += m.sentCount || 0;
      totalReplies += m.repliedCount || 0;
      totalBounces += m.bouncedCount || 0;
      totalOptOuts += m.optedOutCount || 0;
      activeProspects += m.activeEnrollments || 0;
      totalEnrollments += m.totalEnrollments || 0;
    }

    const denom = Math.max(totalSent, totalEnrollments, 1);
    const replyRate = totalSent > 0 || totalEnrollments > 0 ? Number(((totalReplies / denom) * 100).toFixed(1)) : 0;
    const bounceRate = totalSent > 0 || totalEnrollments > 0 ? Number(((totalBounces / denom) * 100).toFixed(1)) : 0;
    const optOutRate = totalSent > 0 || totalEnrollments > 0 ? Number(((totalOptOuts / denom) * 100).toFixed(1)) : 0;

    // Period-over-period comparison from recentSends if available
    const daysCount = dateRange === '7d' ? 7 : dateRange === '14d' ? 14 : 30;
    const nowMs = Date.now();
    const periodMs = daysCount * 86400 * 1000;
    const currentPeriodSends = recentSends.filter(
      (s) => nowMs - new Date(s.sentAt).getTime() <= periodMs
    ).length;
    const prevPeriodSends = recentSends.filter((s) => {
      const age = nowMs - new Date(s.sentAt).getTime();
      return age > periodMs && age <= periodMs * 2;
    }).length;

    const sentTrend =
      prevPeriodSends > 0
        ? Math.round(((currentPeriodSends - prevPeriodSends) / prevPeriodSends) * 100)
        : null;

    return {
      totalSent,
      totalReplies,
      totalBounces,
      totalOptOuts,
      activeProspects,
      replyRate,
      bounceRate,
      optOutRate,
      sentTrend
    };
  }, [campaigns, recentSends, dateRange]);

  // Build daily time-series chart data from actual SendLog and Event records
  const dailyChartData = useMemo(() => {
    const days = dateRange === '7d' ? 7 : dateRange === '14d' ? 14 : 30;
    const buckets = [];
    const map = new Map();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400 * 1000);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const entry = { key, label, sent: 0, replies: 0, bounces: 0 };
      buckets.push(entry);
      map.set(key, entry);
    }

    for (const s of recentSends) {
      if (!s.sentAt) continue;
      const key = new Date(s.sentAt).toISOString().slice(0, 10);
      if (map.has(key)) {
        map.get(key).sent += 1;
      }
    }

    for (const ev of recentEvents) {
      if (!ev.createdAt) continue;
      const key = new Date(ev.createdAt).toISOString().slice(0, 10);
      if (map.has(key)) {
        if (ev.type === 'reply') map.get(key).replies += 1;
        if (ev.type === 'bounce') map.get(key).bounces += 1;
      }
    }

    return buckets;
  }, [recentSends, recentEvents, dateRange]);

  // Campaign performance comparison chart data
  const campaignComparisonData = useMemo(() => {
    return campaigns.slice(0, 6).map((c) => ({
      label: c.name,
      sent: c.metrics?.sentCount || 0,
      replies: c.metrics?.repliedCount || 0,
      bounces: c.metrics?.bouncedCount || 0
    }));
  }, [campaigns]);

  // Build unified Activity Timeline from actual records
  const activityItems = useMemo(() => {
    const items = [];

    for (const s of recentSends.slice(0, 10)) {
      items.push({
        id: `send-${s._id}`,
        type: 'send',
        timestamp: new Date(s.sentAt).getTime(),
        timeLabel: formatRelativeTime(s.sentAt),
        title: `Email sent to ${s.contactId?.firstName || s.contactId?.email || 'prospect'}`,
        subtitle: `${s.subject} · via ${s.mailboxId?.address || 'mailbox'}`
      });
    }

    for (const ev of recentEvents.slice(0, 10)) {
      const labelMap = {
        reply: 'Reply received from',
        bounce: 'Hard bounce recorded for',
        opt_out: 'Unsubscribe recorded for',
        complaint: 'Spam complaint recorded for',
        auto_reply: 'Out-of-office auto-reply from'
      };
      items.push({
        id: `ev-${ev._id}`,
        type: ev.type === 'reply' ? 'reply' : 'bounce',
        timestamp: new Date(ev.createdAt).getTime(),
        timeLabel: formatRelativeTime(ev.createdAt),
        title: `${labelMap[ev.type] || 'Activity for'} ${
          ev.contactId?.firstName || ev.contactId?.email || ev.fromAddress || 'contact'
        }`,
        subtitle: ev.subject || ev.snippet || ''
      });
    }

    for (const c of campaigns.slice(0, 5)) {
      if (c.startedAt) {
        items.push({
          id: `camp-${c._id}`,
          type: 'campaign',
          timestamp: new Date(c.startedAt).getTime(),
          timeLabel: formatRelativeTime(c.startedAt),
          title:
            c.status === 'done'
              ? `Campaign completed: ${c.name}`
              : `Campaign launched: ${c.name}`,
          subtitle: `${c.metrics?.totalEnrollments || 0} prospects enrolled`
        });
      }
    }

    return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 8);
  }, [recentSends, recentEvents, campaigns]);

  // Filtered and sorted Campaign Performance Table
  const filteredCampaigns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return campaigns
      .filter((c) => {
        if (statusFilter !== 'all' && c.status !== statusFilter) return false;
        if (!q) return true;
        return (
          c.name?.toLowerCase().includes(q) ||
          c.sequenceId?.name?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const dir = sortDir === 'asc' ? 1 : -1;
        if (sortBy === 'name') return a.name.localeCompare(b.name) * dir;
        if (sortBy === 'sent') return ((a.metrics?.sentCount || 0) - (b.metrics?.sentCount || 0)) * dir;
        if (sortBy === 'replies') return ((a.metrics?.repliedCount || 0) - (b.metrics?.repliedCount || 0)) * dir;
        if (sortBy === 'bounceRate') {
          const brA = (a.metrics?.bouncedCount || 0) / Math.max(1, a.metrics?.sentCount || 1);
          const brB = (b.metrics?.bouncedCount || 0) / Math.max(1, b.metrics?.sentCount || 1);
          return (brA - brB) * dir;
        }
        return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      });
  }, [campaigns, searchQuery, statusFilter, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredCampaigns.length / PAGE_SIZE));
  const paginatedCampaigns = filteredCampaigns.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (field) => {
    if (sortBy === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortDir('desc');
    }
  };

  const userFirstName = (user?.name || 'Rama Consultants').split(' ')[0];

  return (
    <div className="space-y-6">
      {/* Dashboard Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">
            {getTimeGreeting()}, {userFirstName}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Here&apos;s what&apos;s happening with your outreach campaigns.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Date Range Selector */}
          <div className="inline-flex items-center rounded-lg border border-slate-200/90 bg-white p-0.5 text-xs shadow-sm">
            <Calendar className="w-3.5 h-3.5 text-slate-400 ml-2.5 mr-1 hidden sm:inline" />
            {[
              { id: '7d', label: '7D' },
              { id: '14d', label: '14D' },
              { id: '30d', label: '30D' },
              { id: 'all', label: 'All' }
            ].map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setDateRange(r.id)}
                className={`px-2.5 py-1.5 rounded-md font-medium transition-colors ${
                  dateRange === r.id
                    ? 'bg-[#0B1324] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={loadOverview}
            title="Refresh metrics"
            className="saas-btn-secondary !px-2.5"
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
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm flex items-center justify-between gap-4">
          <span>{error}</span>
          <button onClick={loadOverview} className="font-semibold underline shrink-0">
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton cards={5} />
      ) : (
        <>
          {/* 5 KPI Analytics Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard
              label="Emails Sent"
              value={kpis.totalSent.toLocaleString()}
              trend={kpis.sentTrend}
              subtext={`${campaigns.length} total campaign${campaigns.length === 1 ? '' : 's'}`}
              icon={Send}
              status="neutral"
            />
            <MetricCard
              label="Reply Rate"
              value={`${kpis.replyRate}%`}
              subtext={`${kpis.totalReplies} total replies`}
              benchmark="Target: 2–8%"
              icon={MessageSquare}
              status={kpis.replyRate >= 2 ? 'positive' : 'neutral'}
            />
            <MetricCard
              label="Bounce Rate"
              value={`${kpis.bounceRate}%`}
              subtext={`${kpis.totalBounces} hard bounces`}
              benchmark="Limit: <2%"
              icon={AlertTriangle}
              status={
                kpis.bounceRate >= 3
                  ? 'danger'
                  : kpis.bounceRate >= 2
                    ? 'warning'
                    : 'neutral'
              }
            />
            <MetricCard
              label="Opt-Out Rate"
              value={`${kpis.optOutRate}%`}
              subtext={`${kpis.totalOptOuts} unsubscribes`}
              icon={UserMinus}
              status="neutral"
            />
            <MetricCard
              label="Active Prospects"
              value={kpis.activeProspects.toLocaleString()}
              subtext="Currently in sequence"
              icon={Users}
              status="positive"
            />
          </div>

          {/* Analytics Charts Section */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7">
              <AnalyticsChart
                title="Email Sending Activity"
                subtitle="Outbound volume and prospect replies over time"
                type="area"
                data={dailyChartData}
                series={[
                  { key: 'sent', label: 'Emails Sent', color: '#059669' },
                  { key: 'replies', label: 'Replies', color: '#2563EB' }
                ]}
              />
            </div>

            <div className="lg:col-span-5">
              <AnalyticsChart
                title={
                  secondaryChartMode === 'trends'
                    ? 'Reply vs. Bounce Trends'
                    : 'Campaign Performance Comparison'
                }
                subtitle={
                  secondaryChartMode === 'trends'
                    ? 'Daily positive engagement vs. delivery bounces'
                    : 'Sent volume and replies by campaign'
                }
                type="bar"
                data={
                  secondaryChartMode === 'trends'
                    ? dailyChartData.slice(-7)
                    : campaignComparisonData
                }
                series={
                  secondaryChartMode === 'trends'
                    ? [
                        { key: 'replies', label: 'Replies', color: '#059669' },
                        { key: 'bounces', label: 'Bounces', color: '#E11D48' }
                      ]
                    : [
                        { key: 'sent', label: 'Sent', color: '#0B1324' },
                        { key: 'replies', label: 'Replies', color: '#059669' }
                      ]
                }
                rightHeader={
                  <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setSecondaryChartMode('trends')}
                      className={`px-2 py-0.5 rounded ${
                        secondaryChartMode === 'trends'
                          ? 'bg-white text-slate-900 font-medium shadow-sm'
                          : 'text-slate-500'
                      }`}
                    >
                      Trends
                    </button>
                    <button
                      type="button"
                      onClick={() => setSecondaryChartMode('campaigns')}
                      className={`px-2 py-0.5 rounded ${
                        secondaryChartMode === 'campaigns'
                          ? 'bg-white text-slate-900 font-medium shadow-sm'
                          : 'text-slate-500'
                      }`}
                    >
                      Campaigns
                    </button>
                  </div>
                }
              />
            </div>
          </div>

          {/* Campaign Performance Table */}
          <div className="saas-card overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Campaign Performance</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Monitor active sequences, reply rates, and deliverability status across campaigns.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="relative w-full sm:w-56">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search campaigns..."
                    className="saas-input !pl-8 !py-1.5 !text-xs"
                  />
                </div>

                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="saas-select !w-auto !py-1.5 !text-xs"
                >
                  <option value="all">All Statuses</option>
                  <option value="running">Running</option>
                  <option value="paused">Paused</option>
                  <option value="draft">Draft</option>
                  <option value="done">Completed</option>
                </select>
              </div>
            </div>

            {filteredCampaigns.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={Send}
                  title="No campaigns match your filters"
                  description="Create your first outreach campaign to start enrolling verified B2B prospects."
                  action={
                    <button
                      type="button"
                      onClick={() => navigate('/campaign-wizard')}
                      className="saas-btn-accent"
                    >
                      <Plus className="w-4 h-4" />
                      Create Campaign
                    </button>
                  }
                />
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100 text-xs sm:text-sm">
                    <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-5 py-3 text-left">
                          <button
                            type="button"
                            onClick={() => toggleSort('name')}
                            className="inline-flex items-center gap-1 hover:text-slate-800"
                          >
                            Campaign Name
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-left">Sequence</th>
                        <th className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => toggleSort('sent')}
                            className="inline-flex items-center gap-1 hover:text-slate-800"
                          >
                            Emails Sent
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => toggleSort('replies')}
                            className="inline-flex items-center gap-1 hover:text-slate-800"
                          >
                            Replies
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => toggleSort('bounceRate')}
                            className="inline-flex items-center gap-1 hover:text-slate-800"
                          >
                            Bounce Rate
                            <ArrowUpDown className="w-3 h-3" />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-5 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {paginatedCampaigns.map((c) => {
                        const sent = c.metrics?.sentCount || 0;
                        const replies = c.metrics?.repliedCount || 0;
                        const bounces = c.metrics?.bouncedCount || 0;
                        const enrolled = Math.max(sent, c.metrics?.totalEnrollments || 0, 1);
                        const replyPct = ((replies / enrolled) * 100).toFixed(1);
                        const bouncePct = ((bounces / enrolled) * 100).toFixed(1);

                        return (
                          <tr
                            key={c._id}
                            className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                            onClick={() => navigate(`/campaigns?id=${c._id}`)}
                          >
                            <td className="px-5 py-3.5">
                              <div className="font-semibold text-slate-900">{c.name}</div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                {c.metrics?.totalContacts || c.contactIds?.length || 0} prospects
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-slate-600">
                              <div className="font-medium text-slate-800">
                                {c.sequenceId?.name || '—'}
                              </div>
                              <div className="text-xs text-slate-400">
                                {c.sequenceId?.steps?.length || 0} steps
                              </div>
                            </td>
                            <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-800">
                              {sent}
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span className="font-mono font-semibold text-emerald-700">
                                {replies}
                              </span>
                              <span className="text-xs text-slate-400 ml-1">({replyPct}%)</span>
                            </td>
                            <td className="px-4 py-3.5 text-right">
                              <span
                                className={`font-mono font-medium ${
                                  Number(bouncePct) >= 2 ? 'text-rose-600' : 'text-slate-700'
                                }`}
                              >
                                {bouncePct}%
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              <StatusBadge status={c.status} size="xs" />
                            </td>
                            <td
                              className="px-5 py-3.5 text-right space-x-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {(c.status === 'running' || c.status === 'paused') && (
                                <button
                                  type="button"
                                  onClick={() => handleToggleCampaignStatus(c)}
                                  className="saas-btn-secondary !px-2.5 !py-1 !text-xs"
                                  title={c.status === 'running' ? 'Pause' : 'Resume'}
                                >
                                  {c.status === 'running' ? (
                                    <Pause className="w-3.5 h-3.5 text-amber-600" />
                                  ) : (
                                    <Play className="w-3.5 h-3.5 text-emerald-600" />
                                  )}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => navigate(`/campaigns?id=${c._id}`)}
                                className="saas-btn-secondary !px-2.5 !py-1 !text-xs"
                              >
                                <span>Details</span>
                                <ExternalLink className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {totalPages > 1 && (
                  <div className="px-5 py-3 bg-slate-50/60 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                    <span>
                      Showing {(page - 1) * PAGE_SIZE + 1}–
                      {Math.min(page * PAGE_SIZE, filteredCampaigns.length)} of{' '}
                      {filteredCampaigns.length}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                        className="saas-btn-secondary !px-2.5 !py-1 !text-xs"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage(page + 1)}
                        className="saas-btn-secondary !px-2.5 !py-1 !text-xs"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Bottom Grid: Mailbox Health & Recent Activity */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Mailbox Health Section */}
            <div className="lg:col-span-7 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Connected Mailboxes</h2>
                  <p className="text-xs text-slate-500">
                    Daily sending usage, 7-day bounce thresholds, and sender health.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/mailboxes')}
                  className="text-xs font-medium text-emerald-700 hover:underline"
                >
                  Manage Mailboxes →
                </button>
              </div>

              {mailboxes.length === 0 ? (
                <EmptyState
                  icon={Mail}
                  title="No sending mailboxes configured"
                  description="Sync your verified Brevo sender mailbox from the Mailboxes page."
                />
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {mailboxes.map((mb) => (
                    <MailboxCard key={mb._id} mailbox={mb} compact={true} />
                  ))}
                </div>
              )}
            </div>

            {/* Recent Activity Section */}
            <div className="lg:col-span-5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Recent Activity</h2>
                  <p className="text-xs text-slate-500">
                    Live feed of sends, replies, and campaign milestones.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/replies')}
                  className="text-xs font-medium text-emerald-700 hover:underline"
                >
                  Open Inbox →
                </button>
              </div>

              <div className="saas-card p-5">
                <ActivityTimeline items={activityItems} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
