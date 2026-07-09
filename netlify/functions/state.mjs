import { neon } from '@neondatabase/serverless';
import { OAuth2Client } from 'google-auth-library';

// The Google client ID doubles as the token audience. Public value; falls back
// to the shipped one but can be overridden with a Netlify env var.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
  || '1018937888891-krjk5df7cd7cdkhkgfk063cmf7vu6pvi.apps.googleusercontent.com';

const oauth = new OAuth2Client(CLIENT_ID);
const sql = neon(process.env.NETLIFY_DATABASE_URL);

let schemaReady;
function ensureSchema() {
  if (!schemaReady) {
    schemaReady = sql`
      create table if not exists user_state (
        user_id    text primary key,
        email      text,
        data       jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      )`;
  }
  return schemaReady;
}

// Verify the Google ID token and return the account identity, or null.
async function getUser(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const ticket = await oauth.verifyIdToken({ idToken: token, audience: CLIENT_ID });
    const p = ticket.getPayload();
    return { sub: p.sub, email: p.email || null };
  } catch (e) {
    return null;
  }
}

export default async (req) => {
  const user = await getUser(req);
  if (!user) return new Response('Unauthorized', { status: 401 });
  await ensureSchema();

  if (req.method === 'GET') {
    const rows = await sql`select data from user_state where user_id = ${user.sub}`;
    return Response.json(rows.length ? rows[0].data : null);
  }

  if (req.method === 'PUT') {
    let data;
    try { data = await req.json(); } catch (e) { return new Response('Bad JSON', { status: 400 }); }
    await sql`
      insert into user_state (user_id, email, data, updated_at)
      values (${user.sub}, ${user.email}, ${JSON.stringify(data)}::jsonb, now())
      on conflict (user_id) do update
        set data = excluded.data, email = excluded.email, updated_at = now()`;
    return Response.json({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
};

export const config = { path: '/api/state' };
