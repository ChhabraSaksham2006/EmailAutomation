import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Mail,
  Users,
  GitBranch,
  Send,
  Inbox,
  ShieldBan,
  Settings,
  LogOut,
  HelpCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Search,
  Bell,
  ChevronRight,
  Plus,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { apiFetch } from '../api.js';

const MAIN_NAV = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/mailboxes', label: 'Mailboxes', icon: Mail },
  { to: '/contacts', label: 'Contacts', icon: Users },
  { to: '/sequences', label: 'Sequences', icon: GitBranch },
  { to: '/campaigns', label: 'Campaigns', icon: Send },
  { to: '/replies', label: 'Replies', icon: Inbox }
];

const MANAGEMENT_NAV = [
  { to: '/suppression', label: 'Suppression List', icon: ShieldBan },
  { to: '/settings', label: 'Settings', icon: Settings }
];

const PAGE_META = {
  '/dashboard': { section: 'Overview', title: 'Dashboard' },
  '/mailboxes': { section: 'Outreach', title: 'Mailboxes' },
  '/contacts': { section: 'CRM', title: 'Contacts' },
  '/sequences': { section: 'Automation', title: 'Sequences' },
  '/campaigns': { section: 'Outreach', title: 'Campaigns' },
  '/campaign-wizard': { section: 'Campaigns', title: 'New Campaign' },
  '/replies': { section: 'Inbox', title: 'Replies' },
  '/suppression': { section: 'Management', title: 'Suppression List' },
  '/settings': { section: 'Management', title: 'Settings' }
};

export function AppLayout({ user, onLogout, children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [quickSearch, setQuickSearch] = useState('');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [unreadRepliesCount, setUnreadRepliesCount] = useState(0);
  const [recentReplies, setRecentReplies] = useState([]);

  useEffect(() => {
    setMobileOpen(false);
    setShowNotifications(false);
    setShowProfileMenu(false);
    setShowSearchDropdown(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    apiFetch('/replies?interestedStatus=unreviewed')
      .then((res) => {
        const list = res.replies || [];
        setUnreadRepliesCount(list.length);
        setRecentReplies(list.slice(0, 5));
      })
      .catch(() => {});
  }, [location.pathname]);

  const currentMeta = PAGE_META[location.pathname] || {
    section: 'Workspace',
    title: 'Overview'
  };

  const quickNavMatches = [...MAIN_NAV, ...MANAGEMENT_NAV, { to: '/campaign-wizard', label: 'Create New Campaign', icon: Plus }].filter(
    (item) => item.label.toLowerCase().includes(quickSearch.trim().toLowerCase())
  );

  const renderNavLink = (item) => {
    const Icon = item.icon;
    const isReplies = item.to === '/replies';

    return (
      <NavLink
        key={item.to}
        to={item.to}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          `group relative flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
            isActive
              ? 'bg-emerald-500/15 text-white border border-emerald-500/30'
              : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
          }`
        }
      >
        {({ isActive }) => (
          <>
            <div className="flex items-center gap-3 min-w-0">
              <Icon
                className={`w-4 h-4 shrink-0 transition-colors ${
                  isActive ? 'text-emerald-400' : 'text-slate-400 group-hover:text-slate-200'
                }`}
              />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </div>
            {!collapsed && isReplies && unreadRepliesCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                {unreadRepliesCount}
              </span>
            )}
          </>
        )}
      </NavLink>
    );
  };

  const SidebarContent = ({ isMobile = false }) => (
    <div className="flex flex-col h-full bg-[#0B1324] text-slate-200 select-none">
      {/* Brand Header */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800/80 shrink-0">
        <button
          type="button"
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2.5 text-left min-w-0"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 font-bold text-sm">
            RC
          </div>
          {(!collapsed || isMobile) && (
            <div className="min-w-0">
              <div className="font-semibold text-sm text-white tracking-tight truncate leading-tight">
                Rama Consultants
              </div>
              <div className="text-[11px] text-slate-400 truncate">Email Outreach</div>
            </div>
          )}
        </button>

        {isMobile ? (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 hidden lg:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        )}
      </div>

      {/* Quick Action CTA */}
      <div className="p-3 border-b border-slate-800/60">
        <button
          type="button"
          onClick={() => navigate('/campaign-wizard')}
          title={collapsed && !isMobile ? 'New Campaign' : undefined}
          className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors shadow-sm ${
            collapsed && !isMobile ? 'px-0' : ''
          }`}
        >
          <Plus className="w-4 h-4 shrink-0" />
          {(!collapsed || isMobile) && <span>New Campaign</span>}
        </button>
      </div>

      {/* Navigation Sections */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
        <div className="space-y-1">
          {(!collapsed || isMobile) && (
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Outreach Platform
            </div>
          )}
          {MAIN_NAV.map(renderNavLink)}
        </div>

        <div className="space-y-1">
          {(!collapsed || isMobile) && (
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Management
            </div>
          )}
          {MANAGEMENT_NAV.map(renderNavLink)}
        </div>
      </div>

      {/* Bottom Account & Support Section */}
      <div className="p-3 border-t border-slate-800/80 space-y-1.5 shrink-0">
        <button
          type="button"
          onClick={() => setShowHelpModal(true)}
          title={collapsed && !isMobile ? 'Help & Deliverability Guide' : undefined}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] transition-colors"
        >
          <HelpCircle className="w-4 h-4 shrink-0" />
          {(!collapsed || isMobile) && <span>Help & Support</span>}
        </button>

        <div className="pt-1.5 border-t border-slate-800/60 flex items-center justify-between gap-2 px-2 py-1.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-emerald-400 shrink-0">
              {(user?.name || user?.email || 'R')[0].toUpperCase()}
            </div>
            {(!collapsed || isMobile) && (
              <div className="min-w-0">
                <div className="text-xs font-medium text-white truncate">
                  {user?.name || 'Rama Consultants'}
                </div>
                <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
              </div>
            )}
          </div>

          {(!collapsed || isMobile) && (
            <button
              type="button"
              onClick={onLogout}
              title="Sign Out"
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5 shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex">
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-slate-800 transition-all duration-200 sticky top-0 h-screen z-30 ${
          collapsed ? 'w-[68px]' : 'w-60'
        }`}
      >
        <SidebarContent isMobile={false} />
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-64 max-w-[82vw] h-full z-10">
            <SidebarContent isMobile={true} />
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar */}
        <header className="h-16 bg-white/95 backdrop-blur border-b border-slate-200/80 sticky top-0 z-20 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="lg:hidden p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <nav className="flex items-center gap-1.5 text-xs sm:text-sm min-w-0">
              <span className="text-slate-400 font-medium hidden sm:inline">
                {currentMeta.section}
              </span>
              <ChevronRight className="w-3.5 h-3.5 text-slate-300 hidden sm:inline shrink-0" />
              <span className="font-semibold text-slate-900 truncate">{currentMeta.title}</span>
            </nav>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-2.5">
            {/* Quick Search / Command Bar */}
            <div className="relative hidden md:block w-60">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={quickSearch}
                onFocus={() => setShowSearchDropdown(true)}
                onBlur={() => setTimeout(() => setShowSearchDropdown(false), 180)}
                onChange={(e) => {
                  setQuickSearch(e.target.value);
                  setShowSearchDropdown(true);
                }}
                placeholder="Jump to module..."
                className="w-full pl-8 pr-3 py-1.5 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200/90 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-600 transition-colors"
              />
              {showSearchDropdown && quickNavMatches.length > 0 && (
                <div className="absolute left-0 right-0 mt-1.5 bg-white rounded-xl border border-slate-200 shadow-elevated py-1.5 z-40">
                  {quickNavMatches.map((m) => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.to}
                        type="button"
                        onMouseDown={() => {
                          navigate(m.to);
                          setQuickSearch('');
                        }}
                        className="w-full px-3 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2.5"
                      >
                        <Icon className="w-3.5 h-3.5 text-slate-400" />
                        <span>{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Notifications Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  setShowProfileMenu(false);
                }}
                className="relative p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadRepliesCount > 0 && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                )}
              </button>

              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl border border-slate-200 shadow-elevated z-40 overflow-hidden">
                  <div className="px-4 py-3 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-900">Notifications</span>
                    <span className="text-[11px] text-slate-500">
                      {unreadRepliesCount} unreviewed
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                    {recentReplies.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No unreviewed replies right now.
                      </div>
                    ) : (
                      recentReplies.map((r) => (
                        <button
                          key={r._id}
                          type="button"
                          onClick={() => {
                            setShowNotifications(false);
                            navigate('/replies');
                          }}
                          className="w-full p-3.5 text-left hover:bg-slate-50 transition-colors space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-900 truncate">
                              {r.contactId?.firstName || r.fromAddress}
                            </span>
                            <span className="text-[10px] text-emerald-600 font-medium">Reply</span>
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-1">{r.subject}</p>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="p-2 bg-slate-50 border-t border-slate-100 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setShowNotifications(false);
                        navigate('/replies');
                      }}
                      className="text-xs font-medium text-emerald-700 hover:underline"
                    >
                      Open Replies Inbox →
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* User Profile Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setShowProfileMenu(!showProfileMenu);
                  setShowNotifications(false);
                }}
                className="flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-lg border border-slate-200/80 hover:bg-slate-50 transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-[#0B1324] text-emerald-400 flex items-center justify-center text-xs font-semibold">
                  {(user?.name || user?.email || 'R')[0].toUpperCase()}
                </div>
                <span className="text-xs font-medium text-slate-700 hidden sm:inline max-w-[140px] truncate">
                  {user?.name || user?.email}
                </span>
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl border border-slate-200 shadow-elevated py-1.5 z-40">
                  <div className="px-3.5 py-2.5 border-b border-slate-100">
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {user?.name || 'Rama Consultants'}
                    </div>
                    <div className="text-[11px] text-slate-500 truncate">{user?.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfileMenu(false);
                      navigate('/mailboxes');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    Sending Mailboxes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowProfileMenu(false);
                      navigate('/settings');
                    }}
                    className="w-full px-3.5 py-2 text-left text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Settings className="w-3.5 h-3.5 text-slate-400" />
                    Compliance & Settings
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={onLogout}
                    className="w-full px-3.5 py-2 text-left text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-2 font-medium"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main Page Container */}
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>
      </div>

      {/* Help & Deliverability Guide Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-[1px]">
          <div className="saas-card max-w-lg w-full p-6 space-y-4 shadow-elevated">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Rama Consultants — Outreach Deliverability Guide
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Built-in safeguards protecting your domain reputation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-slate-600">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-slate-900">Human-Paced Sending (30s – 2m Gap):</strong>{' '}
                  Emails are staggered automatically with a randomized 30-second to 2-minute interval per mailbox.
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-slate-900">Automatic Circuit Breaker:</strong>{' '}
                  Mailboxes automatically pause if the 7-day hard bounce rate reaches 3% or if a spam complaint occurs.
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 flex items-start gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <strong className="text-slate-900">One-Click Unsubscribe & Stop on Reply:</strong>{' '}
                  Every outbound email includes RFC 8058 List-Unsubscribe headers and physical address footer (`Nehru Park, SCO 1, S D Market Model Town, Yamuna Nagar, Haryana 135001`).
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="saas-btn-primary"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
