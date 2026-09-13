import { createHmac, timingSafeEqual } from 'node:crypto';

// Our own login session, issued once after a Google sign-in is verified. It is
// a signed cookie (payload + HMAC), so no sessions table is needed. HttpOnly
// keeps it out of page JavaScript; SameSite=Lax keeps other sites from making
// authenticated writes with it.
const COOKIE_NAME = 'ht_session';
const MAX_AGE_S = 90 * 24 * 60 * 60;   // 90 days without using the app
const RENEW_AFTER_S = 24 * 60 * 60;    // re-issue at most once a day while in use

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET is not set (needs 32+ characters)');
  return s;
}
function sign(body) {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}
function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function createSessionValue({ sub, email, name }) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ sub, email, name, iat: now, exp: now + MAX_AGE_S })).toString('base64url');
  return body + '.' + sign(body);
}

// Returns the session payload ({ sub, email, name, iat, exp }) or null.
// Throws only when SESSION_SECRET is missing, so that misconfiguration surfaces.
export function readSession(req) {
  secret();
  const raw = parseCookies(req.headers.get('cookie'))[COOKIE_NAME];
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const got = Buffer.from(sig);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p || !p.sub || !p.exp || p.exp * 1000 <= Date.now()) return null;
  return p;
}

export function sessionCookie(req, value, maxAge = MAX_AGE_S) {
  // Secure on https (production); omitted on http://localhost for `netlify dev`.
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function clearedSessionCookie(req) {
  return sessionCookie(req, '', 0);
}

// Sliding expiry: a session in regular use keeps pushing its 90 days forward.
export function renewedSessionCookie(req, session) {
  const age = Math.floor(Date.now() / 1000) - (session.iat || 0);
  return age > RENEW_AFTER_S ? sessionCookie(req, createSessionValue(session)) : null;
}
