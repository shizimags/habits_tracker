// Unauthenticated diagnostic: reports which env vars are present (as booleans
// only — never the actual values) so DB-linking issues are visible without
// needing a valid Google token. Safe to leave deployed; leaks no secrets.
const CHECK_VARS = ['NETLIFY_DATABASE_URL', 'NETLIFY_DATABASE_URL_UNPOOLED', 'DATABASE_URL', 'NEON_DATABASE_URL', 'GOOGLE_CLIENT_ID'];

export default async () => {
  const present = {};
  for (const name of CHECK_VARS) present[name] = !!process.env[name];
  return Response.json({ envVarsPresent: present });
};

export const config = { path: '/api/diag' };
