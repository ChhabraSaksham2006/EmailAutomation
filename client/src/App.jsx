import React, { useState, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation
} from 'react-router-dom';
import { apiFetch, getStoredToken, setStoredToken } from './api.js';
import { ToastProvider } from './components/ui.jsx';
import { AppLayout } from './components/AppLayout.jsx';

import LoginPage from './pages/LoginPage.jsx';
import OverviewDashboardPage from './pages/OverviewDashboardPage.jsx';
import MailboxesPage from './pages/MailboxesPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import SequencesPage from './pages/SequencesPage.jsx';
import CampaignWizardPage from './pages/CampaignWizardPage.jsx';
import CampaignDashboardPage from './pages/CampaignDashboardPage.jsx';
import RepliesInboxPage from './pages/RepliesInboxPage.jsx';
import SuppressionPage from './pages/SuppressionPage.jsx';
import UnsubscribePublicPage from './pages/UnsubscribePublicPage.jsx';

function AppShell() {
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const isPublicUnsubscribe = location.pathname.startsWith('/unsubscribe/');

  useEffect(() => {
    if (isPublicUnsubscribe) {
      setCheckingAuth(false);
      return;
    }
    const token = getStoredToken();
    if (!token) {
      setCheckingAuth(false);
      return;
    }
    apiFetch('/auth/me')
      .then((data) => {
        setUser(data.user);
      })
      .catch(() => {
        setStoredToken(null);
        setUser(null);
      })
      .finally(() => {
        setCheckingAuth(false);
      });
  }, [isPublicUnsubscribe]);

  if (isPublicUnsubscribe) {
    return (
      <Routes>
        <Route path="/unsubscribe/:token" element={<UnsubscribePublicPage />} />
      </Routes>
    );
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#0B1324] flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300 text-sm font-medium">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 font-bold text-xs">
            RC
          </div>
          <span>Loading Rama Consultants workspace...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onAuthenticated={(u) => setUser(u)} />;
  }

  const handleLogout = () => {
    setStoredToken(null);
    setUser(null);
  };

  return (
    <AppLayout user={user} onLogout={handleLogout}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<OverviewDashboardPage user={user} />} />
        <Route path="/mailboxes" element={<MailboxesPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/sequences" element={<SequencesPage />} />
        <Route path="/campaign-wizard" element={<CampaignWizardPage />} />
        <Route path="/campaigns" element={<CampaignDashboardPage />} />
        <Route path="/replies" element={<RepliesInboxPage />} />
        <Route path="/suppression" element={<SuppressionPage />} />
        <Route path="/settings" element={<SuppressionPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppShell />
      </ToastProvider>
    </BrowserRouter>
  );
}
