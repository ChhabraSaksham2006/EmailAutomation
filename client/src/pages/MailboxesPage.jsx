import React, { useState, useEffect } from 'react';
import {
  RefreshCw,
  Mail,
  ShieldCheck,
  CheckCircle2,
  Activity,
  Send
} from 'lucide-react';
import { apiFetch } from '../api.js';
import {
  PageHeader,
  MetricCard,
  MailboxCard,
  StatusBadge,
  EmptyState,
  LoadingSkeleton,
  useToast
} from '../components/ui.jsx';

export default function MailboxesPage() {
  const { addToast } = useToast();
  const [mailboxes, setMailboxes] = useState([]);
  const [brevoStatus, setBrevoStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');

  const loadMailboxes = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/mailboxes');
      setMailboxes(data.mailboxes || []);
      if (data.brevoStatus) setBrevoStatus(data.brevoStatus);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMailboxes();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    try {
      const data = await apiFetch('/mailboxes/sync-env', {
        method: 'POST'
      });
      setMailboxes(data.mailboxes || []);
      setBrevoStatus(data.brevoStatus || null);
      addToast('Mailbox configuration and sender status refreshed.');
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handlePause = async (id) => {
    try {
      await apiFetch(`/mailboxes/${id}/pause`, {
        method: 'POST',
        body: { reason: 'Paused manually by administrator' }
      });
      addToast('Mailbox paused.');
      loadMailboxes();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleResume = async (mb) => {
    try {
      await apiFetch(`/mailboxes/${mb._id}/resume`, {
        method: 'POST',
        body: {
          status: 'active',
          acknowledgeComplaints: (mb.health?.complaintsCount || 0) > 0
        }
      });
      addToast('Mailbox resumed and active.');
      loadMailboxes();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleCapChange = async (mb, newCap) => {
    try {
      await apiFetch(`/mailboxes/${mb._id}`, {
        method: 'PUT',
        body: { dailyCap: Number(newCap) }
      });
      addToast(`Daily sending limit updated to ${newCap}/day.`);
      loadMailboxes();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const totalSentToday = mailboxes.reduce((acc, m) => acc + (m.sentToday || 0), 0);
  const totalDailyCapacity = mailboxes.reduce((acc, m) => acc + (m.dailyCap || 0), 0);
  const activeCount = mailboxes.filter((m) => m.status === 'active').length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mailboxes"
        subtitle="Manage connected sending identities, daily throughput limits, and deliverability health."
        actions={
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="saas-btn-primary"
          >
            <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Refreshing...' : 'Refresh Mailbox Status'}
          </button>
        }
      />

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {/* Summary KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Active Mailboxes"
          value={`${activeCount} / ${mailboxes.length}`}
          subtext="Configured via environment"
          icon={Mail}
          status="positive"
        />
        <MetricCard
          label="Today's Sending Usage"
          value={`${totalSentToday} / ${totalDailyCapacity}`}
          subtext="Paced at 30s–2m per email"
          icon={Send}
        />
        <MetricCard
          label="Delivery Infrastructure"
          value={brevoStatus?.connected ? 'Connected' : 'Ready'}
          subtext={
            brevoStatus?.connected
              ? `${brevoStatus.accountEmail} · ${brevoStatus.creditsRemaining ?? '—'} credits`
              : 'DKIM & DMARC authenticated'
          }
          icon={ShieldCheck}
          status="positive"
        />
      </div>

      {/* Authentication & Safeguards Banner */}
      <div className="saas-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-50/50">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-emerald-600 shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs sm:text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
              <span>Domain Authentication & Circuit Breaker Active</span>
              <StatusBadge status="healthy" label="SPF · DKIM · DMARC" size="xs" />
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Mailboxes automatically pause if the 7-day bounce rate reaches 3% or if a spam complaint is recorded.
            </p>
          </div>
        </div>
        {brevoStatus?.planType && (
          <span className="px-2.5 py-1 rounded-md bg-white border border-slate-200 text-xs font-medium text-slate-700 shrink-0 self-start sm:self-center">
            {String(brevoStatus.planType).toUpperCase()} PLAN
          </span>
        )}
      </div>

      {/* Mailbox Cards Grid */}
      {loading ? (
        <LoadingSkeleton cards={2} />
      ) : mailboxes.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="No sending mailboxes found"
          description="Click Refresh Mailbox Status above to load your configured sender mailbox."
          action={
            <button type="button" onClick={handleSync} className="saas-btn-primary">
              <RefreshCw className="w-4 h-4" />
              Refresh Status
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {mailboxes.map((mb) => (
            <MailboxCard
              key={mb._id}
              mailbox={mb}
              compact={false}
              onPause={handlePause}
              onResume={handleResume}
              onCapChange={handleCapChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
