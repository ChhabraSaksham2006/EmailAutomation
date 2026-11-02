import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../api.js';

export default function UnsubscribePublicPage() {
  const { token } = useParams();
  const [status, setStatus] = useState('processing');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    apiFetch(`/unsubscribe/${token}`, {
      method: 'POST'
    })
      .then((res) => {
        setEmail(res.email || '');
        setStatus('done');
      })
      .catch((err) => {
        setError(err.message);
        setStatus('error');
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 p-8 text-center shadow-sm space-y-4">
        {status === 'processing' && (
          <p className="text-sm text-slate-600">Processing your immediate opt-out request...</p>
        )}

        {status === 'done' && (
          <>
            <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
            <h1 className="text-xl font-bold text-slate-900">You are unsubscribed</h1>
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong className="font-mono text-slate-900">{email}</strong> has been immediately removed from all active outreach sequences and added to our permanent global suppression list.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <AlertTriangle className="w-12 h-12 text-rose-600 mx-auto" />
            <h1 className="text-xl font-bold text-slate-900">Invalid Unsubscribe Link</h1>
            <p className="text-sm text-slate-600">{error || 'This link could not be verified.'}</p>
          </>
        )}
      </div>
    </div>
  );
}
