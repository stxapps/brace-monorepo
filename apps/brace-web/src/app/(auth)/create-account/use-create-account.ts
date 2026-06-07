'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usernameAvailableQueryOptions } from '@stxapps/react';
import {
  ApiError,
  bytesToHex,
  createAccountEndpoint,
  type CreateAccountPayload,
  type CreateAccountValues,
} from '@stxapps/shared';
import { createAccount } from '@stxapps/web-crypto';

import { useAuth } from '@/contexts/auth-provider';
import { api } from '@/lib/api';

// App-local because account creation is web-only and the submit sequence reaches
// for web-only crypto — `platform:web` deps can't live in the `platform:agnostic`
// @stxapps/react. (The extension doesn't share this live session: the
// non-extractable encryptionKey can't cross the web↔extension boundary, so the
// extension unlocks on its own — its own sign-in — rather than inheriting it.)
// This is the TanStack analog of a redux-thunk: one async unit you "dispatch"
// (mutate), with isPending/error for free and onSuccess as the store update.

// Typed failures so the form can route each to the right field/message. The
// component owns react-hook-form's setError (form-local state); the hook owns
// the orchestration and just signals which kind of failure occurred.
export class UsernameTakenError extends Error {}
export class UsernameCheckError extends Error {}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  const { setSession } = useAuth();

  return useMutation({
    mutationFn: async (values: CreateAccountValues) => {
      // Step 1: authoritative availability re-check on the exact submitted
      // value. fetchQuery reuses the live query's cache, so a paused-on name
      // resolves instantly; the server still re-checks at creation to close
      // the type→submit race.
      let available: boolean;
      try {
        ({ available } = await queryClient.fetchQuery(
          usernameAvailableQueryOptions(api, values.username),
        ));
      } catch {
        throw new UsernameCheckError();
      }
      if (!available) throw new UsernameTakenError();

      // Step 2: create the account's keys from (username, password) via the
      // client KDF (Argon2id → HKDF, run off-thread in a worker). The root is a
      // fresh random DEK; the password-KEK (Argon2id over the username salt, so
      // two users with the same password get different keys) wraps it. Yields the
      // publicKey (the Ed25519 key the server verifies us by, not an identifier —
      // the server mints its own userId), a non-extractable AES-256-GCM key for
      // data, a `sign` closure over the private key (which never leaves
      // @stxapps/web-crypto), and `passwordDoor` — the wrapped DEK to persist
      // server-side.
      const account = await createAccount(values.username, values.password);

      // Step 3: prove key ownership by signing a timestamped payload — which also
      // carries the wrapped password door, so the signature covers exactly what
      // the server persists — then POST it to exchange for a session. The signed
      // value is the EXACT JSON string the server verifies against, so we stringify
      // once and both sign and send that string (see createAccountRequestSchema).
      const payload = JSON.stringify({
        action: 'create-account',
        username: values.username,
        publicKey: account.publicKey,
        passwordDoor: {
          wrappedDek: bytesToHex(account.passwordDoor.wrappedDek),
          iv: bytesToHex(account.passwordDoor.iv),
        },
        timestamp: Date.now(),
      } satisfies CreateAccountPayload);
      const signature = await account.sign(payload);

      // POST to exchange the proof for a session. The server re-checks username
      // uniqueness here (the directory claim) to close the step-1→step-3 race; a
      // 409 routes back to the form's setError as UsernameTakenError. This is a
      // write, so it isn't cancelled on unmount.
      // TODO: send a client-generated idempotency key so a retry after a dropped
      // client (e.g. browser back mid-flight) can't create a duplicate account.
      let session;
      try {
        session = await api.call(createAccountEndpoint, { payload, signature });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) throw new UsernameTakenError();
        throw err;
      }

      // The encryptionKey is the non-extractable AES key for the user's data; it
      // can't be serialized, so it rides back with the session for onSuccess to
      // stash in client-only state alongside the session token.
      return { session, encryptionKey: account.encryptionKey };
    },
    // Persist via the auth context in onSuccess (not the component's mutateAsync
    // continuation) because it's hook-level and survives the form unmounting (e.g.
    // browser back), so a success that lands after navigation isn't lost.
    // setSession both writes the session store and flips app auth state to
    // authenticated, so the UI reacts to the new login. The component keeps only
    // the failure→setError mapping, which is UI feedback and fine to drop when
    // gone. `values` is the original mutate() input, so the username is here.
    onSuccess: async ({ session, encryptionKey }, values) => {
      await setSession({
        username: values.username,
        token: session.token,
        expiresAt: session.expiresAt,
        encryptionKey,
      });
    },
  });
}
