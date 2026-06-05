// ID and token helpers. Uses the Web Crypto API (`crypto.*`), which is a global
// in the Workers runtime — no Node imports, no `nodejs_compat` flag needed.

// A random, collision-resistant id for rows (users, sessions). UUID v4
// is plenty for primary keys here; we don't need sortable/k-ordered ids.
export function newId(): string {
  return crypto.randomUUID();
}

// A high-entropy opaque session token handed to the client. 32 random bytes,
// base64url-encoded. The RAW token is returned to the client exactly once (at
// sign-in / account creation); only its hash is persisted — see hashToken.
export function newSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

// SHA-256 of a token, hex-encoded. We store the HASH in the sessions table, not
// the token itself, so a master-DB leak can't be replayed as live sessions
// (same reason passwords are hashed). The auth guard hashes the incoming bearer
// token and looks it up by hash.
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
