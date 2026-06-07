import { accountsDb } from '../db/db-routes';
import { accountKeysRepo,type DoorType } from '../db/repositories/account-keys';
import { usernamesRepo } from '../db/repositories/usernames';
import { usersRepo } from '../db/repositories/users';
import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { type IssuedSession, issueSession } from './session';

// Account creation under the DEK door model. The root of an account is a random
// DEK (generated client-side, never sent); the client sends the derived public
// key plus one wrapped-DEK blob per "door" (password at minimum). The server
// stores the credential + wrapped blobs and mints a session. The user's actual
// data lives in the durable object keyed by userId. See docs/account.md.
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
// PRIMARY KEY on usernames.username is the real race guard (see createAccount).
// The directory lives in ACCOUNTS_DB (global), so it's queried directly, not via
// db-routes.
export async function isUsernameTaken(env: Bindings, username: string): Promise<boolean> {
  return (await usernamesRepo(env.ACCOUNTS_DB).findByUsername(username)) !== null;
}

export async function createAccount(
  env: Bindings,
  input: CreateAccountInput,
): Promise<CreateAccountResult> {
  // TODO: verify proof-of-possession of the keypair (the sign-in check analog)
  // and validate the door material BEFORE provisioning anything, once the
  // create-account contract lands in @stxapps/shared.

  const directory = usernamesRepo(env.ACCOUNTS_DB);

  // Cheap pre-check → clean 409 on the common case; the PK conflict in the batch
  // below is the real race guard.
  if (await directory.findByUsername(input.username)) {
    throw new ApiError(409, 'username_taken', 'Username is already taken');
  }

  const userId = newId();

  // New accounts go to the primary ACCOUNTS_DB today (account_db_id = NULL). When
  // a shard is added, assign its id here; the username claim ALWAYS stays in the
  // global directory (env.ACCOUNTS_DB).
  const accountDbId: string | null = null;
  const db = accountsDb(env, accountDbId);

  // Atomic create: claim the username + write the credential + write every
  // wrapped-DEK door in ONE D1 transaction (db.batch is all-or-nothing). All
  // three tables live in ACCOUNTS_DB today, so db === env.ACCOUNTS_DB and this is
  // fully atomic.
  //
  // NOTE (future sharding): once accountDbId is non-null, `db` is a shard and the
  // username claim (global directory) can no longer share this batch. It splits
  // into: (1) claim username in env.ACCOUNTS_DB, (2) atomically write
  // users+account_keys in the shard, (3) compensate by deleting the claim if (2)
  // fails. Uniqueness and users↔account_keys atomicity both survive; only the
  // claim↔account link degrades to a reclaimable orphan. See docs/account.md.
  const users = usersRepo(db);
  const keys = accountKeysRepo(db);
  try {
    await db.batch([
      directory.insertStmt({ username: input.username, userId, accountDbId }),
      users.insertStmt({ id: userId, publicKey: input.publicKey }),
      ...input.doors.map((d) =>
        keys.insertStmt({ userId, doorType: d.doorType, wrappedDek: d.wrappedDek, iv: d.iv }),
      ),
    ]);
  } catch {
    // Lost the username race after the pre-check (PK conflict) or a constraint
    // failed. The batch is all-or-nothing, so nothing partial was written.
    throw new ApiError(409, 'username_taken', 'Username is already taken');
  }

  const session = await issueSession(env, { id: userId, accountDbId });
  return { userId, session };
}
