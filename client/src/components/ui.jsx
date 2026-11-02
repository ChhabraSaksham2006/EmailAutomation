import React, { createContext, useContext, useState, useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Clock,
  Flame,
  PauseCircle,
  PlayCircle,
  Mail,
  Send,
  MessageSquare,
  ShieldBan,
  Sparkles,
  X,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

// ============================================================================
// Toast Notification System
// ============================================================================
const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center justify-between gap-3 px-4 py-3 rounded-xl border shadow-elevated text-xs font-medium transition-all ${
              t.type === 'error'
                ? 'bg-[#0B1324] text-rose-200 border-rose-500/40'
                : t.type === 'warning'
                  ? 'bg-[#0B1324] text-amber-200 border-amber-500/40'
                  : 'bg-[#0B1324] text-white border-slate-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {t.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              ) : t.type === 'warning' ? (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="leading-snug">{t.message}</span>
            </div>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="text-slate-400 hover:text-white p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx || { addToast: () => {} };
}

// ============================================================================
// PageHeader
// ============================================================================
export function PageHeader({ title, subtitle, badge, actions }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-1">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {actions}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// StatusBadge
// ============================================================================
const BADGE_STYLES = {
  active: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  running: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  valid: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  healthy: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  interested: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  replied: 'bg-emerald-50 text-emerald-700 border-emerald-200/80',
  completed: 'bg-blue-50 text-blue-700 border-blue-200/80',
  done: 'bg-blue-50 text-blue-700 border-blue-200/80',
  warming: 'bg-amber-50 text-amber-700 border-amber-200/80',
  paused: 'bg-amber-50 text-amber-700 border-amber-200/80',
  risky: 'bg-amber-50 text-amber-700 border-amber-200/80',
  unreviewed: 'bg-amber-50 text-amber-700 border-amber-200/80',
  warning: 'bg-amber-50 text-amber-700 border-amber-200/80',
  bounced: 'bg-rose-50 text-rose-700 border-rose-200/80',
  invalid: 'bg-rose-50 text-rose-700 border-rose-200/80',
  failed: 'bg-rose-50 text-rose-700 border-rose-200/80',
  critical: 'bg-rose-50 text-rose-700 border-rose-200/80',
  opted_out: 'bg-rose-50 text-rose-700 border-rose-200/80',
  opt_out: 'bg-rose-50 text-rose-700 border-rose-200/80',
  complaint: 'bg-rose-50 text-rose-700 border-rose-200/80',
  draft: 'bg-slate-100 text-slate-600 border-slate-200/80',
  unverified: 'bg-slate-100 text-slate-600 border-slate-200/80',
  not_interested: 'bg-slate-100 text-slate-600 border-slate-200/80',
  manual: 'bg-slate-100 text-slate-600 border-slate-200/80'
};

const DOT_COLORS = {
  active: 'bg-emerald-500',
  running: 'bg-emerald-500',
  valid: 'bg-emerald-500',
  healthy: 'bg-emerald-500',
  interested: 'bg-emerald-500',
  replied: 'bg-emerald-500',
  completed: 'bg-blue-500',
  done: 'bg-blue-500',
  warming: 'bg-amber-500',
  paused: 'bg-amber-500',
  risky: 'bg-amber-500',
  unreviewed: 'bg-amber-500',
  warning: 'bg-amber-500',
  bounced: 'bg-rose-500',
  invalid: 'bg-rose-500',
  failed: 'bg-rose-500',
  critical: 'bg-rose-500',
  opted_out: 'bg-rose-500',
  opt_out: 'bg-rose-500',
  complaint: 'bg-rose-500'
};

export function StatusBadge({ status = 'draft', label, showDot = true, size = 'sm' }) {
  const key = String(status || 'draft').toLowerCase();
  const style = BADGE_STYLES[key] || BADGE_STYLES.draft;
  const dot = DOT_COLORS[key] || 'bg-slate-400';
  const text = label || String(status).replace(/_/g, ' ');

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-medium capitalize ${style} ${
        size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'
      }`}
    >
      {showDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
      {text}
    </span>
  );
}

// ============================================================================
// MetricCard
// ============================================================================
export function MetricCard({
  label,
  value,
  subtext,
  benchmark,
  trend,
  trendLabel,
  status = 'neutral', // 'neutral' | 'positive' | 'warning' | 'danger'
  icon: Icon
}) {
  const iconWrapClass =
    status === 'danger'
      ? 'bg-rose-50 text-rose-600 border-rose-100'
      : status === 'warning'
        ? 'bg-amber-50 text-amber-600 border-amber-100'
        : status === 'positive'
          ? 'bg-emerald-50 text-emerald-600 border-emerald-100'
          : 'bg-slate-50 text-slate-700 border-slate-200/60';

  const valueClass =
    status === 'danger'
      ? 'text-rose-600'
      : status === 'warning'
        ? 'text-amber-600'
        : 'text-slate-900';

  return (
    <div className="saas-card p-5 flex flex-col justify-between min-h-[132px] hover:border-slate-300/90 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-slate-500">{label}</span>
        {Icon && (
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${iconWrapClass}`}>
            <Icon className="w-4 h-4" />
          </div>
        )}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-2xl sm:text-[26px] font-semibold tracking-tight leading-none ${valueClass}`}>
            {value}
          </span>
          {typeof trend === 'number' && !Number.isNaN(trend) && (
            <span
              className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded ${
                trend >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {trend >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {Math.abs(trend)}%
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-500">
          <span className="truncate">{subtext || trendLabel || '—'}</span>
          {benchmark && (
            <span className="text-[11px] font-medium text-slate-400 shrink-0">{benchmark}</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MailboxCard (Compact or Detailed)
// ============================================================================
export function MailboxCard({
  mailbox,
  compact = false,
  onPause,
  onResume,
  onCapChange
}) {
  const sentToday = mailbox.sentToday || 0;
  const dailyCap = mailbox.dailyCap || 35;
  const usagePct = Math.min(100, Math.round((sentToday / Math.max(1, dailyCap)) * 100));
  const bounceRate = (mailbox.health?.bounceRate7d || 0) * 100;
  const bouncePct = bounceRate.toFixed(1);
  const complaints = mailbox.health?.complaintsCount || 0;

  // Health state: Green (<2% bounce & 0 complaints & active), Amber (2-3% or warming/paused), Red (>=3% or complaints > 0)
  const healthState =
    complaints > 0 || bounceRate >= 3
      ? 'critical'
      : bounceRate >= 2 || mailbox.status !== 'active'
        ? 'warning'
        : 'healthy';

  const healthLabel =
    healthState === 'critical' ? 'Critical' : healthState === 'warning' ? 'Warning' : 'Healthy';

  const barColor =
    healthState === 'critical'
      ? 'bg-rose-500'
      : usagePct >= 90
        ? 'bg-amber-500'
        : 'bg-emerald-600';

  return (
    <div className="saas-card p-5 flex flex-col justify-between gap-4 hover:border-slate-300/90 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900 truncate">
              {mailbox.displayName || 'Sending Mailbox'}
            </h3>
            <StatusBadge status={mailbox.status} size="xs" />
            <StatusBadge status={healthState} label={healthLabel} size="xs" />
          </div>
          <p className="text-xs font-mono text-slate-600 mt-1 truncate">{mailbox.address}</p>
          {!compact && (mailbox.senderTitle || mailbox.senderCompany) && (
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {[mailbox.senderTitle, mailbox.senderCompany].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {(onPause || onResume) && (
          <div className="shrink-0">
            {mailbox.status === 'paused' ? (
              <button
                type="button"
                onClick={() => onResume && onResume(mailbox)}
                className="saas-btn-accent !px-3 !py-1.5 !text-xs"
              >
                <PlayCircle className="w-3.5 h-3.5" />
                Resume
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onPause && onPause(mailbox._id)}
                className="saas-btn-secondary !px-3 !py-1.5 !text-xs"
              >
                <PauseCircle className="w-3.5 h-3.5 text-amber-600" />
                Pause
              </button>
            )}
          </div>
        )}
      </div>

      {mailbox.health?.lastPausedReason && mailbox.status === 'paused' && (
        <div className="p-2.5 rounded-lg bg-rose-50/80 border border-rose-200/80 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{mailbox.health.lastPausedReason}</span>
        </div>
      )}

      {/* Daily sending usage progress bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 font-medium">Daily Sending Usage</span>
          <span className="font-mono font-semibold text-slate-800">
            {sentToday} / {dailyCap} <span className="text-slate-400 font-normal">({usagePct}%)</span>
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
            style={{ width: `${usagePct}%` }}
          />
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-slate-100">
        <div className="p-2.5 rounded-lg bg-slate-50/80 border border-slate-100">
          <div className="text-[11px] text-slate-500">7d Bounce Rate</div>
          <div
            className={`text-sm font-semibold mt-0.5 ${
              bounceRate >= 2 ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {bouncePct}%
            <span className="text-[11px] font-normal text-slate-400 ml-1">
              ({mailbox.health?.bounces7d || 0}/{mailbox.health?.sent7d || 0})
            </span>
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50/80 border border-slate-100">
          <div className="text-[11px] text-slate-500">Complaints</div>
          <div
            className={`text-sm font-semibold mt-0.5 ${
              complaints > 0 ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {complaints}
          </div>
        </div>

        <div className="p-2.5 rounded-lg bg-slate-50/80 border border-slate-100">
          <div className="text-[11px] text-slate-500">Daily Limit</div>
          <div className="text-sm font-semibold text-slate-900 mt-0.5">{dailyCap}/day</div>
        </div>
      </div>

      {!compact && onCapChange && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-500 font-medium">Configure Daily Limit:</span>
          <div className="flex items-center gap-1.5">
            {[20, 30, 35, 40, 50].map((capVal) => (
              <button
                key={capVal}
                type="button"
                onClick={() => onCapChange(mailbox, capVal)}
                className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${
                  mailbox.dailyCap === capVal
                    ? 'bg-[#0B1324] text-white border-[#0B1324]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {capVal}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ActivityTimeline
// ============================================================================
export function ActivityTimeline({ items = [], emptyMessage = 'No recent outreach activity recorded yet.' }) {
  if (!items || items.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  const getEventStyle = (type) => {
    switch (type) {
      case 'send':
        return { icon: Send, bg: 'bg-emerald-50 text-emerald-600 border-emerald-200' };
      case 'reply':
        return { icon: MessageSquare, bg: 'bg-blue-50 text-blue-600 border-blue-200' };
      case 'bounce':
      case 'complaint':
      case 'opt_out':
        return { icon: ShieldBan, bg: 'bg-rose-50 text-rose-600 border-rose-200' };
      case 'campaign':
        return { icon: Sparkles, bg: 'bg-slate-100 text-slate-700 border-slate-200' };
      default:
        return { icon: Clock, bg: 'bg-slate-50 text-slate-500 border-slate-200' };
    }
  };

  return (
    <div className="flow-root">
      <ul className="-mb-6">
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          const { icon: Icon, bg } = getEventStyle(item.type);

          return (
            <li key={item.id || idx}>
              <div className="relative pb-6">
                {!isLast && (
                  <span
                    className="absolute left-4 top-8 -ml-px h-full w-0.5 bg-slate-100"
                    aria-hidden="true"
                  />
                )}
                <div className="relative flex items-start space-x-3">
                  <div
                    className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${bg}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-slate-900 truncate">{item.title}</p>
                      <time className="text-[11px] text-slate-400 shrink-0">{item.timeLabel}</time>
                    </div>
                    {item.subtitle && (
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{item.subtitle}</p>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ============================================================================
// EmptyState
// ============================================================================
export function EmptyState({ icon: Icon = Mail, title, description, action }) {
  return (
    <div className="saas-card p-10 text-center max-w-lg mx-auto my-4">
      <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200/80 flex items-center justify-center text-slate-600 mx-auto mb-3.5">
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="text-xs sm:text-sm text-slate-500 mt-1.5 leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

// ============================================================================
// LoadingSkeleton
// ============================================================================
export function LoadingSkeleton({ rows = 4, cards = 0 }) {
  if (cards > 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: cards }).map((_, i) => (
          <div key={i} className="saas-card p-5 space-y-3 animate-pulse">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-7 w-16 bg-slate-200 rounded" />
            <div className="h-2.5 w-32 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="saas-card p-6 space-y-4 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center justify-between gap-4">
          <div className="space-y-2 flex-1">
            <div className="h-3.5 bg-slate-200 rounded w-1/3" />
            <div className="h-2.5 bg-slate-100 rounded w-1/2" />
          </div>
          <div className="h-6 w-20 bg-slate-100 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// ConfirmationDialog
// ============================================================================
export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/50 backdrop-blur-[1px]">
      <div className="saas-card max-w-md w-full p-6 space-y-4 shadow-elevated">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                variant === 'danger'
                  ? 'bg-rose-50 text-rose-600 border border-rose-200'
                  : 'bg-amber-50 text-amber-600 border border-amber-200'
              }`}
            >
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-900">{title}</h3>
              <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-relaxed">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-slate-600 p-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button type="button" onClick={onCancel} className="saas-btn-secondary">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={variant === 'danger' ? 'saas-btn-danger' : 'saas-btn-primary'}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
