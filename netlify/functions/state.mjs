import { neon } from '@neondatabase/serverless';
import { getConnectionString } from '@netlify/database';
import { readSession, renewedSessionCookie } from '../lib/session.mjs';

// Netlify Database exposes its connection string as NETLIFY_DB_URL, not the
// more guessable NETLIFY_DATABASE_URL. @netlify/database's getConnectionString()
// resolves it correctly across Netlify's runtimes instead of reading process.env directly.
let _sql, _schema;
function db() {
  if (!_sql) _sql = neon(getConnectionString());
  return _sql;
}
function ensureSchema() {
  const sql = db();
  if (!_schema) {
    _schema = sql`
      create table if not exists user_state (
        user_id    text primary key,
        email      text,
        data       jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      )`;
  }
  return _schema;
}

export default async (req) => {
  try {
    // Identity comes from our session cookie (set by /api/session after a
    // verified Google sign-in), not from a short-lived Google token.
    const session = readSession(req);
    if (!session) return new Response('Unauthorized', { status: 401 });
    const renew = renewedSessionCookie(req, session);
    const headers = renew ? { 'Set-Cookie': renew } : {};

    const sql = db();
    await ensureSchema();

    if (req.method === 'GET') {
      const rows = await sql`select data from user_state where user_id = ${session.sub}`;
      return Response.json(rows.length ? rows[0].data : null, { headers });
    }

    if (req.method === 'PUT') {
      let data;
      try { data = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
      await sql`
        insert into user_state (user_id, email, data, updated_at)
        values (${session.sub}, ${session.email}, ${JSON.stringify(data)}::jsonb, now())
        on conflict (user_id) do update
          set data = excluded.data, email = excluded.email, updated_at = now()`;
      return Response.json({ ok: true }, { headers });
    }

    return new Response('Method Not Allowed', { status: 405 });
  } catch (e) {
    return Response.json({ error: String(e && e.message || e) }, { status: 500 });
  }
};

export const config = { path: '/api/state' };
