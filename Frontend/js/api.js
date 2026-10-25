// Thin fetch wrapper: base URL, auth header, error normalisation, 401 handling.
const API_BASE = ''; // same origin: the Express server also serves this frontend
const TOKEN_KEY = 'authToken';
const USER_KEY = 'loggedInUser';

// "Remember me" -> localStorage (persists); otherwise sessionStorage (cleared when the tab closes).
const stores = () => { try { return [localStorage, sessionStorage]; } catch { return []; } };
const safe = {
  get(k) { for (const s of stores()) { try { const v = s.getItem(k); if (v !== null) return v; } catch { /* ignore */ } } return null; },
  set(k, v, remember = true) { try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch { /* ignore */ } },
  del(k) { for (const s of stores()) { try { s.removeItem(k); } catch { /* ignore */ } } },
};

export const session = {
  get token() { return safe.get(TOKEN_KEY); },
  get user() { try { return JSON.parse(safe.get(USER_KEY) || 'null'); } catch { return null; } },
  set(token, user, remember = true) { this.clear(); safe.set(TOKEN_KEY, token, remember); safe.set(USER_KEY, JSON.stringify(user), remember); },
  clear() { safe.del(TOKEN_KEY); safe.del(USER_KEY); },
};

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data || {}; }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export async function api(path, { method = 'GET', body, blob = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  let res;
  try {
    res = await fetch(API_BASE + '/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && session.token && !/^\/(login|signup)/.test(path)) {
      onUnauthorized();
    }
    throw new ApiError(data.error || 'Something went wrong. Please try again.', res.status, data);
  }
  return blob ? res.blob() : res.json();
}
