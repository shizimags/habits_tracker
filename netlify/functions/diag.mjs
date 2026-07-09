// Unauthenticated diagnostic: reports which env vars are present (as booleans
// only — never the actual values) so DB-linking issues are visible without
// needing a valid Google token. Safe to leave deployed; leaks no secrets.
import { getConnectionString } from '@netlify/database';

const CHECK_VARS = ['NETLIFY_DB_URL', 'NETLIFY_DATABASE_URL', 'GOOGLE_CLIENT_ID'];

export default async () => {
  const present = {};
  for (const name of CHECK_VARS) present[name] = !!process.env[name];
  let netlifyDatabaseResolves = false, netlifyDatabaseError = null;
  try { netlifyDatabaseResolves = !!getConnectionString(); }
  catch (e) { netlifyDatabaseError = String(e && e.message || e); }
  return Response.json({ envVarsPresent: present, netlifyDatabaseResolves, netlifyDatabaseError });
};

export const config = { path: '/api/diag' };
