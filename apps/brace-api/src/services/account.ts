import { usersRepo } from '../db/repositories/users';
import type { Bindings } from '../lib/env';
import { ApiError } from '../lib/errors';
import { newId } from '../lib/ids';
import { type IssuedSession, issueSession } from './session';

// Account creation - write the user row in MASTER,
// then mint a session. The user's actual data then lives in the durable object
// keyed by userId.
//
// STATUS: skeleton. The credential side (KDF params, challenge/signature
// verification) is NOT implemented yet and must be added with the shared
// `createAccount` contract — see docs/api-contracts.md and the TODOs below.

export type CreateAccountResult = {
  userId: string;
  session: IssuedSession;
};

export async function createAccount(
  env: Bindings,
  input: { username: string /* TODO: + credential material (pubkey / KDF salt) */ },
): Promise<CreateAccountResult> {
  const users = usersRepo(env.DB_MASTER);

  // Authoritative uniqueness check (the GET /auth/username-available endpoint is
  // only a pre-check). The UNIQUE constraint on users.username is the real race
  // guard; this check just turns the common case into a clean 409.
  if (await users.findByUsername(input.username)) {
    throw new ApiError(409, 'username_taken', 'Username is already taken');
  }

  // TODO: verify credential material here (e.g. proof-of-possession of the
  // client keypair / KDF challenge) BEFORE provisioning anything, once the
  // create-account contract lands in @stxapps/shared.

  // Durable object for user must be deterministically reachable by userId (may have prefix or suffix).


  const userId = newId();
  try {
    await users.insert({ id: userId, username: input.username });
  } catch {
    // UNIQUE(username) lost the race after our pre-check. Surface the conflict to the client.
    throw new ApiError(409, 'username_taken', 'Username is already taken');
  }

  // TODO: persist credential material (pubkey / KDF params) — likely a
  // `credentials` table in MASTER keyed by userId — within the same flow.

  const session = await issueSession(env, { id: userId });
  return { userId, session };
}
