import { OAuth2Client } from 'google-auth-library';
import { createSessionValue, readSession, sessionCookie, clearedSessionCookie, renewedSessionCookie } from '../lib/session.mjs';

// The Google client ID doubles as the token audience. Public value; falls back
// to the shipped one but can be overridden with a Netlify env var.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '1018937888891-krjk5df7cd7cdkhkgfk063cmf7vu6pvi.apps.googleusercontent.com';

const oauth = new OAuth2Client(CLIENT_ID);

// POST   { credential }  verify a Google sign-in once, set the 90-day session cookie
// GET                    who is signed in (also renews the cookie)
// DELETE                 sign out — clear the cookie
export default async (req) => {
  try {
    if (req.method === 'POST') {
      // Requiring JSON means a cross-site form can't post here without a CORS preflight.
      if (!(req.headers.get('content-type') || '').includes('application/json')) {
        return new Response('Unsupported Media Type', { status: 415 });
      }
      let credential;
      try { ({ credential } = await req.json()); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
      if (!credential) return new Response('Missing credential', { status: 400 });

      let p;
      try {
        const ticket = await oauth.verifyIdToken({ idToken: credential, audience: CLIENT_ID });
        p = ticket.getPayload();
      } catch (e) {
        return new Response('Invalid Google credential', { status: 401 });
      }
      const user = { sub: p.sub, email: p.email || null, name: p.name || null };
      return Response.json(
        { user: { email: user.email, name: user.name } },
        { headers: { 'Set-Cookie': sessionCookie(req, createSessionValue(user)) } }
      );
    }

    if (req.method === 'GET') {
      const session = readSession(req);
      if (!session) return new Response('Unauthorized', { status: 401 });
      const renew = renewedSessionCookie(req, session);
      return Response.json(
        { user: { email: session.email, name: session.name } },
        { headers: renew ? { 'Set-Cookie': renew } : {} }
      );
    }

    if (req.method === 'DELETE') {
      return new Response(null, { status: 204, headers: { 'Set-Cookie': clearedSessionCookie(req) } });
    }

    return new Response('Method Not Allowed', { status: 405 });
  } catch (e) {
    return Response.json({ error: String(e && e.message || e) }, { status: 500 });
  }
};

export const config = { path: '/api/session' };
