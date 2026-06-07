import { accountsDb, assignAccountDbId } from '../db/db-routes';
import { accountKeysRepo, type DoorType } from '../db/repositories/account-keys';
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
// STATUS: storage + topology are wired; the create-account CONTRACT (the shared
// request schema carrying publicKey + door blobs) and the proof-of-possession
// check are still open items — no route calls createAccount yet. See the TODO
// below and docs/account.md "open items".

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
  // TODO: verify proof-of-possession of the keypair (the sign-in check analog)
  // and validate the door material BEFORE provisioning anything, once the
  // create-account contract lands in @stxapps/shared.

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
