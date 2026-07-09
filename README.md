# Habit Tracker 2026

Local-first habit tracker (PWA) with optional **Google Sign-In** and **Netlify DB** (Postgres) sync.
Works fully offline from `localStorage`; when signed in, each user's data is saved to one row in Postgres and follows them across devices.

## Structure

```
public/                 static app (served as the site)
  index.html, app.js, styles.css, sw.js, config.js, manifest.json, icons
netlify/functions/
  state.mjs             GET/PUT /api/state — verifies Google token, reads/writes Postgres
netlify.toml            publish=public, functions dir
package.json            function deps (@neondatabase/serverless, google-auth-library)
```

## One-time setup on Netlify

1. **Connect this repo** to your Netlify site (Site → Build & deploy → link repository). Netlify installs deps and deploys automatically on push.
2. **Add Netlify DB** (Site → Integrations/Extensions → Netlify DB, or `netlify db init`). It provisions Neon Postgres and sets `NETLIFY_DATABASE_URL` automatically. The `user_state` table is created on first request — no migration needed.
3. **Google OAuth**: the client ID is in `public/config.js` and `netlify/functions/state.mjs`. In Google Cloud Console, ensure the site URL is an **Authorized JavaScript origin**, and add your testers as **Test users** (or publish the consent screen).

## Data model

One row per Google account:

```sql
create table user_state (
  user_id    text primary key,   -- Google account id (sub)
  email      text,
  data       jsonb not null,     -- the whole app state
  updated_at timestamptz not null default now()
);
```

## Local dev

`netlify dev` runs the static site + functions + DB binding together at http://localhost:8888.
(Plain `python3 -m http.server` serves the UI but not `/api/state`.)
