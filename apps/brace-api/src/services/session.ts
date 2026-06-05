import { sessionsRepo } from '../db/repositories/sessions';
import type { Bindings } from '../lib/env';
import { hashToken,newId, newSessionToken } from '../lib/ids';

// Session lifecycle, master-DB-backed. The auth GUARD (middleware/auth.ts) does
// the per-request read directly via sessionsRepo; this service owns the WRITE
// side — minting and revoking sessions — used by the sign-in / create-account
// flows.

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type IssuedSession = {
  // The RAW token. Returned to the client exactly once; only its hash is stored.
  token: string;
  sessionId: string;
  expiresAt: number;
};

// Mint a session for a user. We persist the token HASH (never the raw token) and
// hand the raw token back to the caller to return to the client. shardId is
// denormalized onto the session so the auth guard resolves the shard in one read.
export async function issueSession(
  env: Bindings,
  user: { id: string; shardId: string },
): Promise<IssuedSession> {
  const token = newSessionToken();
  const sessionId = newId();
  const expiresAt = Date.now() + SESSION_TTL_MS;

  await sessionsRepo(env.DB_MASTER).insert({
    id: sessionId,
    tokenHash: await hashToken(token),
    userId: user.id,
    shardId: user.shardId,
    expiresAt,
  });

  return { token, sessionId, expiresAt };
}

export async function revokeSession(env: Bindings, sessionId: string): Promise<void> {
  await sessionsRepo(env.DB_MASTER).deleteById(sessionId);
}
