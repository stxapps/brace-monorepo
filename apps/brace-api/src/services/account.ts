import { DOOR_PASSWORD, type DoorType } from '@stxapps/shared';

import { accountsDb, assignAccountDbId } from '../db/db-routes';
import { accountKeysRepo } from '../db/repositories/account-keys';
import { usernamesRepo } from '../db/repositories/usernames';
import { usersRepo } from '../db/repositories/users';
import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { type IssuedSession, issueSession } from './session';

// Account creation under the DEK door model, across separate databases. The root
// of an account is a random DEK (generated client-side, never sent); the client
// sends the derived public key plus one wrapped-DEK blob per "door" (password at
// minimum). The user's actual data lives in the durable object keyed by userId.
// See docs/account.md.
//
// The username DIRECTORY (DIRECTORY_DB) and the account rows (an ACCOUNTS_DB_N
// shard) are in different databases, so this is CLAIM-THEN-WRITE rather than one
// transaction: (1) claim the username (the authoritative uniqueness gate), (2)
// atomically write users + account_keys in the shard, (3) release the claim if
// (2) fails so a crash mid-create can't orphan the name. Uniqueness is always
// enforced (directory PK) and users↔account_keys stay atomic (same shard); only
// the claim↔account link is non-transactional, with the orphan reclaimable.
//
// STATUS: wired end-to-end. POST /v1/auth/create-account (routes/auth.ts) verifies
// proof-of-possession + the signed contract (verifyAuthProof over the shared
// createAccountPayloadSchema), then calls this to claim + write. This service owns
// only the claim-then-write; the route owns transport + proof. The orphan-claim
// sweeper is still open — see docs/account.md "open items".

export type CreateAccountResult = {
  userId: string;
  session: IssuedSession;
};

// One wrapped-DEK door to persist. wrappedDek = AES-256-GCM(KEK, DEK), iv = its
// GCM nonce. At create-account this is at least the 'password' door.
export type CreateAccountDoor = {
  doorType: DoorType;
  wrappedDek: Uint8Array;
  iv: Uint8Array;
};

export type CreateAccountInput = {
  username: string;
  publicKey: string;
  doors: CreateAccountDoor[];
};

// Cheap pre-check behind GET /v1/auth/username-available. NOT authoritative: the
// claim in createAccount is the real race guard. The directory lives in
// DIRECTORY_DB (global), queried directly, not via db-routes.
export async function isUsernameTaken(env: Bindings, username: string): Promise<boolean> {
  return (await usernamesRepo(env.DIRECTORY_DB).findByUsername(username)) !== null;
}

export async function createAccount(
  env: Bindings,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  // Proof-of-possession and contract/door validation already happened upstream in
  // the route (verifyAuthProof + the zod request schema), so this trusts its typed
  // input and owns only the claim-then-write.

  const directory = usernamesRepo(env.DIRECTORY_DB);
  const userId = newId();

  // Placement: which shard this account's rows go in, stored explicitly on the
  // account (and its directory/session rows). Today always '1'; the policy lives
  // in assignAccountDbId(). The claim ALWAYS stays in the global directory.
  const accountDbId = assignAccountDbId();

  // (1) CLAIM the username — the authoritative, race-free uniqueness gate. A
  // concurrent claim of the same name returns false (no row written), not an
  // error, so a lost race is a clean 409.
  const claimed = await directory.claim({ username: input.username, userId, accountDbId });
  if (!claimed) {
    throw new ApiError(409, 'username_taken', 'Username is already taken');
  }

  // (2) WRITE the account in the shard — users + every wrapped-DEK door in ONE
  // atomic batch (all-or-nothing). This is a DIFFERENT db than the directory, so
  // it can't join the claim in a single transaction.
  const shard = accountsDb(env, accountDbId);
  const users = usersRepo(shard);
  const keys = accountKeysRepo(shard);
  try {
    await shard.batch([
      users.insertStmt({ id: userId, publicKey: input.publicKey }),
      ...input.doors.map((d) =>
        keys.insertStmt({ userId, doorType: d.doorType, wrappedDek: d.wrappedDek, iv: d.iv }),
      ),
    ]);
  } catch (err) {
    // (3) COMPENSATE: the account write failed after we claimed the name, so
    // release the claim to avoid orphaning the username. Best-effort — if this
    // also fails (e.g. the worker dies), a sweeper reclaims claims that have no
    // backing `users` row after a short TTL (TODO: wire the sweeper alongside
    // sessions.deleteExpired). Uniqueness is never violated either way.
    await directory.release(input.username, userId).catch(() => {
      // Best-effort: if the compensating release itself fails, the orphan claim
      // is reclaimed by the sweeper (TODO) — never block on cleanup here.
    });
    // Log the cause for observability (wrangler tail); never leak it to the client.
    console.error('createAccount shard write failed:', err);
    throw new ApiError(500, 'account_create_failed', 'Could not create account, please retry');
  }

  const session = await issueSession(env, { id: userId, accountDbId });
  return { userId, session };
}

// Sign-in, step 1 (PRE-AUTH): hand back the password door's wrapped DEK for a
// username so the client can unwrap the DEK and derive its keys. Resolve the
// username through the directory (the only username→account map), then read the
// 'password' door from the user's shard. A missing user or door is a generic
// not-found — the route renders it as the same opaque failure as a wrong password,
// so this can't be used as a username-existence oracle. (Mass-scraping of this
// offline-attack oracle is blunted by the route's rate limit; richer
// enumeration hardening is still an open item — see docs/account.md.)
export async function getPasswordDoor(
  env: Bindings,
  username: string,
): Promise<{ wrappedDek: Uint8Array; iv: Uint8Array }> {
  const entry = await usernamesRepo(env.DIRECTORY_DB).findByUsername(username);
  if (!entry) throw new ApiError(404, 'not_found', 'No account for that username');

  const password = await accountKeysRepo(accountsDb(env, entry.accountDbId)).findByUserIdAndDoorType(
    entry.userId,
    DOOR_PASSWORD,
  );
  if (!password) throw new ApiError(404, 'not_found', 'No password door for that account');

  return { wrappedDek: password.wrappedDek, iv: password.iv };
}

// Sign-in, step 3: mint a session for a proven sign-in. Proof-of-possession (the
// signature over the payload, freshness, and action) is verified upstream in the
// route via verifyAuthProof; this owns THE load-bearing check — that the presented
// `publicKey` equals the STORED credential for the username — plus the session
// mint. Without that comparison anyone could "sign in" with their own keypair (see
// docs/account.md "the load-bearing sign-in check"). Every credential miss returns
// the SAME opaque 401 so it leaks neither which username exists nor why it failed.
export async function signIn(
  env: Bindings,
  input: { username: string; publicKey: string },
): Promise<{ userId: string; session: IssuedSession }> {
  const invalid = () =>
    new ApiError(401, 'invalid_credentials', 'Incorrect username or password');

  const entry = await usernamesRepo(env.DIRECTORY_DB).findByUsername(input.username);
  if (!entry) throw invalid();

  const user = await usersRepo(accountsDb(env, entry.accountDbId)).findById(entry.userId);
  if (!user) {
    // The directory points at a user row that must exist (both are Tier-0, written
    // together). A dangling pointer is a server-side inconsistency, not a caller
    // error — log it for observability but still answer opaquely.
    console.error('signIn: directory references missing user', entry.userId);
    throw invalid();
  }

  // publicKey is a public credential (not a secret), so a plain compare is fine —
  // there's no secret to leak via timing. It must match the key the signature was
  // already verified against upstream.
  if (input.publicKey !== user.publicKey) throw invalid();

  const session = await issueSession(env, { id: user.id, accountDbId: entry.accountDbId });
  return { userId: user.id, session };
}
