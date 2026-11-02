const API_BASE = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '');

export function getStoredToken() {
  return localStorage.getItem('outreach_token');
}

export function setStoredToken(token) {
  if (token) {
    localStorage.setItem('outreach_token', token);
  } else {
    localStorage.removeItem('outreach_token');
  }
}

export async function apiFetch(path, options = {}) {
  const token = getStoredToken();
  const headers = {
    ...(options.headers || {})
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body:
      options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body
  });

  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();

  if (!res.ok) {
    const errMessage = typeof data === 'object' && data?.error ? data.error : `Request failed (${res.status})`;
    const error = new Error(errMessage);
    error.status = res.status;
    error.payload = data;
    throw error;
  }

  return data;
}
