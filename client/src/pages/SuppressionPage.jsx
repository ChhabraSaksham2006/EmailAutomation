import React, { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ShieldBan,
  Plus,
  Trash2,
  Globe,
  Search,
  ShieldCheck,
  Mail,
  MapPin,
  Bell
} from 'lucide-react';
import { apiFetch } from '../api.js';
import {
  PageHeader,
  StatusBadge,
  EmptyState,
  ConfirmationDialog,
  useToast
} from '../components/ui.jsx';

export default function SuppressionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const activeTab = location.pathname === '/settings' ? 'settings' : 'suppression';

  const [suppressions, setSuppressions] = useState([]);
  const [newEntry, setNewEntry] = useState('');
  const [isDomain, setIsDomain] = useState(false);
  const [reason, setReason] = useState('manual');
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState('all');
  const [entryToRemove, setEntryToRemove] = useState(null);

  const [countriesInput, setCountriesInput] = useState('US, USA, UNITED STATES, IN, IND, INDIA');
  const [postalAddress, setPostalAddress] = useState('');
  const [alertEmail, setAlertEmail] = useState('');
  const [error, setError] = useState('');

  const loadData = async () => {
    setError('');
    try {
      const [supData, compData] = await Promise.all([
        apiFetch('/suppression'),
        apiFetch('/compliance')
      ]);
      setSuppressions(supData.suppressions || []);
      if (compData.config) {
        setCountriesInput((compData.config.clearedCountries || []).join(', '));
        setPostalAddress(compData.config.senderPostalAddress || '');
        setAlertEmail(compData.config.alertEmail || '');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredSuppressions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return suppressions.filter((s) => {
      if (reasonFilter !== 'all' && s.reason !== reasonFilter) return false;
      if (!q) return true;
      return s.email?.toLowerCase().includes(q) || s.reason?.toLowerCase().includes(q);
    });
  }, [suppressions, searchQuery, reasonFilter]);

  const handleAddSuppression = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await apiFetch('/suppression', {
        method: 'POST',
        body: {
          email: newEntry,
          reason,
          isDomain
        }
      });
      addToast(`Added ${newEntry} to suppression list.`);
      setNewEntry('');
      loadData();
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    }
  };

  const handleConfirmRemove = async () => {
    if (!entryToRemove) return;
    try {
      await apiFetch(`/suppression/${entryToRemove._id}`, { method: 'DELETE' });
      addToast(`Removed ${entryToRemove.email} from suppression list.`);
      setEntryToRemove(null);
      loadData();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleSaveCompliance = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const clearedCountries = countriesInput
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter(Boolean);

      await apiFetch('/compliance', {
        method: 'PUT',
        body: {
          clearedCountries,
          senderPostalAddress: postalAddress,
          alertEmail
        }
      });
      addToast('Sender & compliance settings saved.');
      loadData();
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={activeTab === 'settings' ? 'Settings & Compliance' : 'Suppression List'}
        subtitle={
          activeTab === 'settings'
            ? 'Configure sender postal address, cleared outreach regions, and deliverability alerts.'
            : 'Manage blocked email addresses, domains, and automatic unsubscribes.'
        }
        actions={
          <div className="inline-flex rounded-lg border border-slate-200/90 bg-white p-0.5 text-xs shadow-sm">
            <button
              type="button"
              onClick={() => navigate('/suppression')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'suppression'
                  ? 'bg-[#0B1324] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Suppression List ({suppressions.length})
            </button>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#0B1324] text-white'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Settings & Compliance
            </button>
          </div>
        }
      />

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {activeTab === 'suppression' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Add to Suppression Form */}
          <div className="lg:col-span-5 saas-card p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600">
                <ShieldBan className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Block Email or Domain
                </h2>
                <p className="text-xs text-slate-500">
                  Checked before import, queueing, and delivery.
                </p>
              </div>
            </div>

            <form onSubmit={handleAddSuppression} className="space-y-3.5 pt-1">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  {isDomain ? 'Domain to Block' : 'Email Address to Block'}
                </label>
                <input
                  type="text"
                  required
                  value={newEntry}
                  onChange={(e) => setNewEntry(e.target.value)}
                  placeholder={isDomain ? '@competitor.com' : 'optout@company.com'}
                  className="saas-input font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Block Reason
                </label>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="saas-select"
                >
                  <option value="manual">Manual Block</option>
                  <option value="opt_out">Opt-Out / Unsubscribe</option>
                  <option value="bounce">Hard Bounce</option>
                  <option value="complaint">Spam Complaint</option>
                </select>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={isDomain}
                  onChange={(e) => setIsDomain(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-600"
                />
                <span>Block entire domain (e.g. @company.com)</span>
              </label>

              <button type="submit" className="w-full saas-btn-primary">
                <Plus className="w-4 h-4" />
                Add to Suppression List
              </button>
            </form>
          </div>

          {/* Right: Suppression Table */}
          <div className="lg:col-span-7 saas-card overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Suppressed Entries ({filteredSuppressions.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Permanent global blocklist across all sequences.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search blocked..."
                    className="saas-input !pl-8 !py-1.5 !text-xs w-44"
                  />
                </div>
                <select
                  value={reasonFilter}
                  onChange={(e) => setReasonFilter(e.target.value)}
                  className="saas-select !w-auto !py-1.5 !text-xs"
                >
                  <option value="all">All Reasons</option>
                  <option value="manual">Manual</option>
                  <option value="opt_out">Opt-Out</option>
                  <option value="bounce">Bounce</option>
                  <option value="complaint">Complaint</option>
                </select>
              </div>
            </div>

            {filteredSuppressions.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={ShieldBan}
                  title="No suppressed entries found"
                  description="Addresses that unsubscribe, bounce, or are manually blocked will appear here."
                />
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto divide-y divide-slate-100">
                {filteredSuppressions.map((s) => (
                  <div
                    key={s._id}
                    className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                      <span className="font-mono font-semibold text-slate-900 truncate">
                        {s.email}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] uppercase font-medium">
                        {s.type}
                      </span>
                      <StatusBadge status={s.reason} size="xs" />
                    </div>
                    {s.reason !== 'gdpr_deleted' && (
                      <button
                        type="button"
                        onClick={() => setEntryToRemove(s)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        title="Remove from suppression list"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Settings & Compliance Tab */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <form
            onSubmit={handleSaveCompliance}
            className="lg:col-span-7 saas-card p-6 space-y-5"
          >
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <Globe className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Sender & Regional Compliance Configuration
                </h2>
                <p className="text-xs text-slate-500">
                  Applied automatically to all sequences and campaign readiness checks.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                Sender Physical Postal Address (Included in Email Footers)
              </label>
              <input
                type="text"
                required
                value={postalAddress}
                onChange={(e) => setPostalAddress(e.target.value)}
                className="saas-input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-slate-400" />
                Cleared Outreach Country Codes (Comma-separated)
              </label>
              <input
                type="text"
                value={countriesInput}
                onChange={(e) => setCountriesInput(e.target.value)}
                className="saas-input font-mono"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Contacts outside these country codes require an explicit contact-level override before sending.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1.5">
                <Bell className="w-3.5 h-3.5 text-slate-400" />
                Deliverability & Circuit Breaker Alert Email
              </label>
              <input
                type="email"
                value={alertEmail}
                onChange={(e) => setAlertEmail(e.target.value)}
                className="saas-input"
              />
            </div>

            <div className="flex justify-end pt-2">
              <button type="submit" className="saas-btn-accent">
                Save Configuration
              </button>
            </div>
          </form>

          {/* Right: Infrastructure & Security Summary */}
          <div className="lg:col-span-5 space-y-4">
            <div className="saas-card p-5 space-y-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-sm font-semibold text-slate-900">
                  Domain & Compliance Safeguards
                </h3>
              </div>
              <div className="space-y-2.5 text-xs text-slate-600 pt-1">
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span>One-Click Unsubscribe (RFC 8058)</span>
                  <StatusBadge status="healthy" label="Enabled" size="xs" />
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span>Sending Interval Pacing</span>
                  <span className="font-mono font-semibold text-slate-800">30s – 2m</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-slate-100">
                  <span>Hard Bounce Auto-Pause Threshold</span>
                  <span className="font-mono font-semibold text-slate-800">3.0% (7d)</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span>Mailbox Credentials Storage</span>
                  <span className="font-mono font-semibold text-slate-800">Server .env</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmationDialog
        open={Boolean(entryToRemove)}
        title="Remove from Suppression List"
        description={`Are you sure you want to remove ${entryToRemove?.email} from the global suppression list?`}
        confirmLabel="Remove Entry"
        variant="warning"
        onConfirm={handleConfirmRemove}
        onCancel={() => setEntryToRemove(null)}
      />
    </div>
  );
}
