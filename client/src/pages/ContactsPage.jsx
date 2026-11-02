import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Upload,
  Download,
  FileSpreadsheet,
  BookOpen,
  CheckCircle2,
  Sparkles,
  Trash2,
  Edit3,
  Search,
  X,
  Globe,
  Clock
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

const COLUMN_GUIDE = [
  {
    column: 'email',
    required: true,
    variable: '{{email}}',
    description: 'Prospect work email address. Checked automatically against the Suppression List.',
    example: 'sarah.chen@linearflow.io'
  },
  {
    column: 'first_name',
    required: false,
    variable: '{{first_name}}',
    description: 'Prospect first name. Use {{default first_name "there"}} for fallback.',
    example: 'Sarah'
  },
  {
    column: 'company',
    required: false,
    variable: '{{company}}',
    description: 'Company or organization name.',
    example: 'LinearFlow'
  },
  {
    column: 'title',
    required: false,
    variable: '{{title}}',
    description: 'Job title or role.',
    example: 'VP of Engineering'
  },
  {
    column: 'country',
    required: false,
    variable: '{{country}}',
    description: '2-letter ISO country code (US, IN, GB, CA, DE).',
    example: 'IN'
  },
  {
    column: 'timezone',
    required: false,
    variable: 'Schedule Window',
    description: 'IANA timezone (e.g. Asia/Kolkata, America/New_York) for local 9–11 AM delivery.',
    example: 'Asia/Kolkata'
  },
  {
    column: 'target_role_plural',
    required: false,
    variable: '{{target_role_plural}}',
    description: 'Custom variable for role personalization.',
    example: 'operations leaders'
  },
  {
    column: 'one_line_value',
    required: false,
    variable: '{{one_line_value}}',
    description: 'Custom variable for your 1-sentence value proposition.',
    example: 'streamlining regulatory audit readiness'
  },
  {
    column: '<any_custom_column>',
    required: false,
    variable: '{{any_custom_column}}',
    description: 'Any extra column in your Excel/CSV file becomes a {{variable}} automatically.',
    example: 'Custom value per row'
  }
];

export default function ContactsPage() {
  const { addToast } = useToast();

  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showColumnGuide, setShowColumnGuide] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // CRM Search, Filters & Bulk Selection
  const [searchQuery, setSearchQuery] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedIds, setSelectedIds] = useState([]);

  // Import wizard state
  const [selectedFile, setSelectedFile] = useState(null);
  const [defaultSource, setDefaultSource] = useState('manual_research');
  const [defaultSourceNote, setDefaultSourceNote] = useState('Hand-researched B2B prospects');
  const [defaultLawfulBasis, setDefaultLawfulBasis] = useState('legitimate_interest_b2b');
  const [confirmNotPurchasedOrScraped, setConfirmNotPurchasedOrScraped] = useState(false);

  // Slide-over drawer & Confirmation dialog state
  const [activeContact, setActiveContact] = useState(null);
  const [contactToDelete, setContactToDelete] = useState(null);

  const loadContacts = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/contacts');
      const list = data.contacts || [];
      setContacts(list);
      if (list.length === 0) {
        setShowImportWizard(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadContacts();
  }, []);

  const filteredContacts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return contacts.filter((c) => {
      if (verificationFilter !== 'all' && c.verificationStatus !== verificationFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.email?.toLowerCase().includes(q) ||
        c.firstName?.toLowerCase().includes(q) ||
        c.company?.toLowerCase().includes(q) ||
        c.title?.toLowerCase().includes(q) ||
        c.country?.toLowerCase().includes(q)
      );
    });
  }, [contacts, searchQuery, verificationFilter, statusFilter]);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setError('');
  };

  const handleRunImport = async (e) => {
    e.preventDefault();
    if (!selectedFile) return;
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('defaultSource', defaultSource);
      formData.append('defaultSourceNote', defaultSourceNote);
      formData.append('defaultLawfulBasis', defaultLawfulBasis);
      formData.append('confirmNotPurchasedOrScraped', String(confirmNotPurchasedOrScraped));

      const res = await apiFetch('/contacts/import', {
        method: 'POST',
        body: formData
      });

      addToast(
        `Imported ${res.summary.importedCount} new contacts (${res.summary.updatedCount} updated).`
      );
      setSelectedFile(null);
      setShowImportWizard(false);
      loadContacts();
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    }
  };

  const handleVerifyContacts = async (contactIds = null) => {
    setVerifying(true);
    setError('');
    try {
      await apiFetch('/contacts/verify', {
        method: 'POST',
        body: contactIds ? { contactIds } : { verifyAll: true }
      });
      addToast('Email verification completed.');
      await loadContacts();
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setVerifying(false);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!activeContact) return;
    try {
      await apiFetch(`/contacts/${activeContact._id}`, {
        method: 'PUT',
        body: {
          firstName: activeContact.firstName,
          company: activeContact.company,
          title: activeContact.title,
          country: activeContact.country,
          timezone: activeContact.timezone,
          source: activeContact.source,
          lawfulBasis: activeContact.lawfulBasis,
          regionOverride: activeContact.regionOverride
        }
      });
      addToast(`Saved changes for ${activeContact.email}.`);
      setActiveContact(null);
      loadContacts();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!contactToDelete) return;
    try {
      await apiFetch(`/contacts/${contactToDelete._id}/gdpr-delete`, {
        method: 'POST'
      });
      addToast(`${contactToDelete.email} removed and added to suppression list.`);
      setContactToDelete(null);
      if (activeContact?._id === contactToDelete._id) setActiveContact(null);
      loadContacts();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredContacts.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredContacts.map((c) => c._id));
    }
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contacts"
        subtitle="Manage your B2B prospect database, verify email deliverability, and import Excel or CSV lists."
        actions={
          <>
            <a
              href="/api/contacts/template/xlsx"
              download="outreach_contacts_template.xlsx"
              className="saas-btn-secondary"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              Excel Template (.xlsx)
            </a>
            <a
              href="/api/contacts/template/csv"
              download="outreach_contacts_template.csv"
              className="saas-btn-secondary"
            >
              <Download className="w-4 h-4 text-slate-500" />
              CSV Template
            </a>
            <button
              type="button"
              onClick={() => setShowColumnGuide(!showColumnGuide)}
              className="saas-btn-secondary"
            >
              <BookOpen className="w-4 h-4 text-slate-500" />
              {showColumnGuide ? 'Hide Guide' : 'Column Guide'}
            </button>
            <button
              type="button"
              onClick={() => handleVerifyContacts(selectedIds.length > 0 ? selectedIds : null)}
              disabled={verifying || contacts.length === 0}
              className="saas-btn-secondary"
            >
              <Sparkles className="w-4 h-4 text-emerald-600" />
              {verifying
                ? 'Verifying...'
                : selectedIds.length > 0
                  ? `Verify Selected (${selectedIds.length})`
                  : 'Verify Emails'}
            </button>
            <button
              type="button"
              onClick={() => setShowImportWizard(!showImportWizard)}
              className="saas-btn-accent"
            >
              <Upload className="w-4 h-4" />
              {showImportWizard ? 'Close Import' : 'Import Contacts'}
            </button>
          </>
        }
      />

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs sm:text-sm">
          {error}
        </div>
      )}

      {/* Collapsible Column Guide */}
      {showColumnGuide && (
        <div className="saas-card overflow-hidden">
          <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Supported Excel / CSV Columns & Variables
              </h3>
              <p className="text-xs text-slate-500">
                Any custom column you include in your spreadsheet is automatically available as a{' '}
                <code className="font-mono text-emerald-700">{"{{variable}}"}</code> in sequences.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowColumnGuide(false)}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-xs">
              <thead className="bg-slate-50/50 text-slate-500 uppercase text-[11px]">
                <tr>
                  <th className="px-4 py-2.5 text-left">Column Header</th>
                  <th className="px-4 py-2.5 text-left">Required</th>
                  <th className="px-4 py-2.5 text-left">Template Token</th>
                  <th className="px-4 py-2.5 text-left">Description</th>
                  <th className="px-4 py-2.5 text-left">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {COLUMN_GUIDE.map((col, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/60">
                    <td className="px-4 py-2.5 font-mono font-semibold text-slate-900">
                      {col.column}
                    </td>
                    <td className="px-4 py-2.5">
                      {col.required ? (
                        <StatusBadge status="bounced" label="Required" showDot={false} size="xs" />
                      ) : (
                        <StatusBadge status="draft" label="Optional" showDot={false} size="xs" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-emerald-700">{col.variable}</td>
                    <td className="px-4 py-2.5 text-slate-600 max-w-md">{col.description}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-500">{col.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Excel & CSV Import Panel */}
      {showImportWizard && (
        <form onSubmit={handleRunImport} className="saas-card p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Import Prospects from Excel (`.xlsx`, `.xls`) or CSV (`.csv`)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Suppressed addresses and domains are filtered automatically during import.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowImportWizard(false)}
              className="text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="border-2 border-dashed border-slate-200 hover:border-emerald-500 rounded-xl p-8 text-center bg-slate-50/50 transition-colors">
            <FileSpreadsheet className="w-9 h-9 text-emerald-600 mx-auto mb-2.5" />
            <div className="text-sm font-semibold text-slate-900">
              {selectedFile ? (
                <span className="text-emerald-700">
                  {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
                </span>
              ) : (
                'Select an Excel (.xlsx, .xls) or CSV (.csv) file to upload'
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1 mb-4">
              Up to 2,500 contacts per batch. Download the template above for pre-formatted columns.
            </p>
            <label className="cursor-pointer saas-btn-primary">
              <Upload className="w-3.5 h-3.5" />
              {selectedFile ? 'Choose Different File' : 'Browse Computer'}
              <input
                type="file"
                accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Default Contact Source
              </label>
              <select
                value={defaultSource}
                onChange={(e) => setDefaultSource(e.target.value)}
                className="saas-select"
              >
                <option value="manual_research">Manual Research</option>
                <option value="company_website">Company Website</option>
                <option value="linkedin_hand_curated">LinkedIn (Hand-Curated)</option>
                <option value="conference_attendee">Conference / Event</option>
                <option value="inbound_referral">Inbound / Referral</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Default Lawful Basis
              </label>
              <select
                value={defaultLawfulBasis}
                onChange={(e) => setDefaultLawfulBasis(e.target.value)}
                className="saas-select"
              >
                <option value="legitimate_interest_b2b">Legitimate Interest (B2B)</option>
                <option value="public_corporate_contact_b2b">Public Corporate Contact</option>
                <option value="explicit_consent">Explicit Consent</option>
                <option value="existing_business_relationship">Existing Business Relationship</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Default Source Note
              </label>
              <input
                type="text"
                value={defaultSourceNote}
                onChange={(e) => setDefaultSourceNote(e.target.value)}
                className="saas-input"
              />
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/90 flex items-start gap-3">
            <input
              id="confirm-sourcing"
              type="checkbox"
              checked={confirmNotPurchasedOrScraped}
              onChange={(e) => setConfirmNotPurchasedOrScraped(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            <label htmlFor="confirm-sourcing" className="text-xs text-slate-700 leading-relaxed cursor-pointer">
              I confirm that these contacts were legitimately sourced for B2B outreach and are not from a purchased or scraped list.
            </label>
          </div>

          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setShowImportWizard(false)}
              className="saas-btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!confirmNotPurchasedOrScraped || !selectedFile}
              className="saas-btn-accent"
            >
              Import Contacts
            </button>
          </div>
        </form>
      )}

      {/* CRM Contacts Table */}
      <div className="saas-card overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              All Contacts ({filteredContacts.length})
            </h2>
            {selectedIds.length > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
                {selectedIds.length} selected
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-60">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search name, email, company..."
                className="saas-input !pl-8 !py-1.5 !text-xs"
              />
            </div>

            <select
              value={verificationFilter}
              onChange={(e) => setVerificationFilter(e.target.value)}
              className="saas-select !w-auto !py-1.5 !text-xs"
            >
              <option value="all">All Verification</option>
              <option value="valid">Valid</option>
              <option value="risky">Risky</option>
              <option value="unverified">Unverified</option>
              <option value="invalid">Invalid</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="saas-select !w-auto !py-1.5 !text-xs"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="replied">Replied</option>
              <option value="bounced">Bounced</option>
              <option value="opted_out">Opted Out</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="p-6">
            <LoadingSkeleton rows={5} />
          </div>
        ) : filteredContacts.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={Users}
              title="No contacts match your view"
              description="Upload an Excel (.xlsx) or CSV (.csv) file to populate your B2B prospect list."
              action={
                <button
                  type="button"
                  onClick={() => setShowImportWizard(true)}
                  className="saas-btn-accent"
                >
                  <Upload className="w-4 h-4" />
                  Import Excel / CSV
                </button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-xs sm:text-sm">
              <thead className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left w-10">
                    <input
                      type="checkbox"
                      checked={
                        filteredContacts.length > 0 &&
                        selectedIds.length === filteredContacts.length
                      }
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 text-emerald-600"
                    />
                  </th>
                  <th className="px-4 py-3 text-left">Prospect</th>
                  <th className="px-4 py-3 text-left">Company & Role</th>
                  <th className="px-4 py-3 text-left">Region & Timezone</th>
                  <th className="px-4 py-3 text-left">Verification</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {filteredContacts.map((c) => {
                  const checked = selectedIds.includes(c._id);
                  return (
                    <tr
                      key={c._id}
                      onClick={() => setActiveContact({ ...c })}
                      className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                    >
                      <td
                        className="px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelectOne(c._id)}
                          className="rounded border-slate-300 text-emerald-600"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">
                          {c.firstName || '—'}
                        </div>
                        <div className="font-mono text-xs text-slate-500">{c.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{c.company || '—'}</div>
                        <div className="text-xs text-slate-400">{c.title || '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-medium text-slate-700 flex items-center gap-1.5">
                          <Globe className="w-3 h-3 text-slate-400" />
                          <span>{c.country}</span>
                          {c.regionOverride && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 text-[10px]">
                              Override
                            </span>
                          )}
                        </div>
                        <div className="text-slate-400 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          <span>{c.timezone}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.verificationStatus} size="xs" />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={c.status} size="xs" />
                      </td>
                      <td
                        className="px-4 py-3 text-right space-x-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setActiveContact({ ...c })}
                          title="View & Edit Contact"
                          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setContactToDelete(c)}
                          title="Delete & Block Contact"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Contact Detail & Edit Slide-Over Drawer */}
      {activeContact && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-[1px]">
          <div className="bg-white w-full max-w-md h-full shadow-elevated border-l border-slate-200 flex flex-col justify-between overflow-y-auto">
            <form onSubmit={handleSaveEdit} className="p-6 space-y-5 flex-1">
              <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      {activeContact.firstName || 'Contact Details'}
                    </h3>
                    <StatusBadge status={activeContact.status} size="xs" />
                  </div>
                  <p className="text-xs font-mono text-slate-500 mt-0.5">
                    {activeContact.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveContact(null)}
                  className="text-slate-400 hover:text-slate-700 p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={activeContact.firstName || ''}
                    onChange={(e) =>
                      setActiveContact({ ...activeContact, firstName: e.target.value })
                    }
                    className="saas-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Company
                  </label>
                  <input
                    type="text"
                    value={activeContact.company || ''}
                    onChange={(e) =>
                      setActiveContact({ ...activeContact, company: e.target.value })
                    }
                    className="saas-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Job Title
                  </label>
                  <input
                    type="text"
                    value={activeContact.title || ''}
                    onChange={(e) =>
                      setActiveContact({ ...activeContact, title: e.target.value })
                    }
                    className="saas-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Country Code
                  </label>
                  <input
                    type="text"
                    value={activeContact.country || ''}
                    onChange={(e) =>
                      setActiveContact({
                        ...activeContact,
                        country: e.target.value.toUpperCase()
                      })
                    }
                    className="saas-input font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    IANA Timezone
                  </label>
                  <input
                    type="text"
                    value={activeContact.timezone || ''}
                    onChange={(e) =>
                      setActiveContact({ ...activeContact, timezone: e.target.value })
                    }
                    className="saas-input font-mono"
                  />
                </div>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(activeContact.regionOverride)}
                  onChange={(e) =>
                    setActiveContact({ ...activeContact, regionOverride: e.target.checked })
                  }
                  className="mt-0.5 rounded border-slate-300 text-emerald-600"
                />
                <span>
                  Allow outreach to this contact even if their country code is not in the default cleared list.
                </span>
              </label>

              {/* Custom Variables Preview */}
              {activeContact.variables && Object.keys(activeContact.variables).length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="text-xs font-semibold text-slate-700">
                    Imported Custom Variables
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200/80 p-3 space-y-1.5 text-xs">
                    {Object.entries(activeContact.variables).map(([k, v]) => (
                      <div key={k} className="flex items-start justify-between gap-2">
                        <span className="font-mono text-emerald-700">{`{{${k}}}`}</span>
                        <span className="text-slate-700 text-right truncate max-w-[200px]">
                          {String(v || '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setContactToDelete(activeContact)}
                  className="saas-btn-danger !px-3 !py-1.5 !text-xs"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete & Block
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveContact(null)}
                    className="saas-btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="saas-btn-accent">
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Dialog for Delete & Block */}
      <ConfirmationDialog
        open={Boolean(contactToDelete)}
        title="Delete & Block Contact"
        description={`Are you sure you want to remove ${contactToDelete?.email}? Their personal details will be erased and their email hash will be added to the suppression list so they are never emailed again.`}
        confirmLabel="Delete & Block"
        onConfirm={handleConfirmDelete}
        onCancel={() => setContactToDelete(null)}
      />
    </div>
  );
}
