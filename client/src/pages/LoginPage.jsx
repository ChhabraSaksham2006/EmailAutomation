import React, { useState, useEffect } from 'react';
import { Lock, Mail, User, ArrowRight, CheckCircle2 } from 'lucide-react';
import { apiFetch, setStoredToken } from '../api.js';

export default function LoginPage({ onAuthenticated }) {
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch('/auth/status')
      .then((data) => {
        setRegistrationOpen(Boolean(data.registrationOpen));
        if (data.registrationOpen) {
          setMode('register');
        }
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const endpoint = mode === 'register' ? '/auth/register' : '/auth/login';
      const payload = mode === 'register' ? { email, password, name } : { email, password };
      const data = await apiFetch(endpoint, {
        method: 'POST',
        body: payload
      });
      setStoredToken(data.token);
      onAuthenticated(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Left Brand Panel (Desktop) */}
      <div className="hidden lg:flex lg:w-5/12 bg-[#0B1324] text-white p-12 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-sm">
            RC
          </div>
          <div>
            <div className="font-semibold text-base tracking-tight">Rama Consultants</div>
            <div className="text-xs text-slate-400">Email Outreach Platform</div>
          </div>
        </div>

        <div className="space-y-6 max-w-md">
          <h1 className="text-3xl font-semibold tracking-tight leading-snug text-white">
            Precision B2B outreach built for high deliverability.
          </h1>
          <p className="text-sm text-slate-400 leading-relaxed">
            Manage personalized multi-step sequences, verified prospect lists, and human-paced sending from a single workspace.
          </p>

          <div className="space-y-3 pt-2 text-xs text-slate-300">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Authenticated domain delivery (SPF, DKIM & DMARC)</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Human-paced 30s–2m intervals & daily mailbox caps</span>
            </div>
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Automatic stop-on-reply & one-click unsubscribe</span>
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-500">
          Nehru Park, SCO 1, S D Market Model Town, Yamuna Nagar, Haryana 135001
        </div>
      </div>

      {/* Right Authentication Form */}
      <div className="flex-1 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-16">
        <div className="mx-auto w-full max-w-md">
          {/* Mobile Brand Header */}
          <div className="lg:hidden flex items-center gap-2.5 mb-8">
            <div className="w-9 h-9 rounded-lg bg-[#0B1324] text-emerald-400 flex items-center justify-center font-bold text-sm">
              RC
            </div>
            <div>
              <div className="font-semibold text-sm text-slate-900">Rama Consultants</div>
              <div className="text-xs text-slate-500">Email Outreach Platform</div>
            </div>
          </div>

          <div className="saas-card p-7 sm:p-8">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
                {mode === 'register' ? 'Create Administrator Account' : 'Sign in to your workspace'}
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                {mode === 'register'
                  ? 'Set up your primary workspace administrator credentials.'
                  : 'Enter your email and password to access your campaigns.'}
              </p>
            </div>

            {error && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1.5">
                    Full Name
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Rama Consultants"
                      className="saas-input !pl-10"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Work Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="info@ramaconsultants.com"
                    className="saas-input !pl-10"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="saas-input !pl-10"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full saas-btn-primary !py-2.5 mt-2"
              >
                <span>
                  {loading
                    ? 'Signing in...'
                    : mode === 'register'
                      ? 'Create Workspace Account'
                      : 'Sign In'}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {registrationOpen && (
              <div className="mt-5 pt-4 border-t border-slate-100 text-center">
                <button
                  type="button"
                  onClick={() => setMode(mode === 'register' ? 'login' : 'register')}
                  className="text-xs font-medium text-emerald-700 hover:underline"
                >
                  {mode === 'register'
                    ? 'Already have an account? Sign in'
                    : 'Set up initial administrator account'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
