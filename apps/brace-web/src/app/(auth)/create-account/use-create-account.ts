'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usernameAvailableQueryOptions } from '@stxapps/react';
import type { CreateAccountValues } from '@stxapps/shared';
import { deriveAccount } from '@stxapps/web-crypto';

import { api } from '@/lib/api';

// App-local because account creation is web-only (the extension inherits the
// session via storage) and the submit sequence reaches for web-only crypto —
// `platform:web` deps can't live in the `platform:agnostic` @stxapps/react.
// This is the TanStack analog of a redux-thunk: one async unit you "dispatch"
// (mutate), with isPending/error for free and onSuccess as the store update.

// Typed failures so the form can route each to the right field/message. The
// component owns react-hook-form's setError (form-local state); the hook owns
// the orchestration and just signals which kind of failure occurred.
export class UsernameTakenError extends Error {}
export class UsernameCheckError extends Error {}

export function useCreateAccount() {
  const queryClient = useQueryClient();

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

      // Step 2: derive the account from (username, password) via the client
      // KDF (Argon2id → HKDF, run off-thread in a worker). The username is the
      // per-user salt, so two users with the same password get different keys.
      // Yields the publicKey (the Ed25519 key the server verifies us by, not an
      // identifier — the server mints its own userId), a non-extractable
      // AES-256-GCM key for data, and a `sign` closure over the private key —
      // the private key itself never leaves @stxapps/web-crypto.
      const account = await deriveAccount(values.password, values.username);

      // Step 3: prove key ownership by signing a timestamped payload, then POST
      // it to exchange for a session id. The server re-checks username
      // uniqueness here to close the step-1→step-3 race; a "taken" rejection
      // throws UsernameTakenError and routes to the form's setError. This is a
      // write, so don't cancel it on unmount.
      const payload = JSON.stringify({
        publicKey: account.publicKey,
        username: values.username,
        action: 'create-account',
        timestamp: Date.now(),
      });
      const signature = await account.sign(payload);

      // TODO: POST { payload, signature } to the session endpoint (pending),
      // then persist the returned session id + account.encryptionKey in
      // onSuccess. Send a client-generated idempotency key with the POST so a
      // retry after a dropped client (e.g. browser back mid-flight) is safe and
      // won't create a duplicate account, rather than aborting the in-flight
      // request. Stubbed until the session endpoint lands.
      console.log('create account', { username: values.username, signature });
    },
    // TODO: persist the returned session in onSuccess (auth context /
    // queryClient) rather than in the component's mutateAsync continuation —
    // onSuccess is hook-level and survives the form unmounting (browser back),
    // so a success that lands after navigation isn't lost. The component keeps
    // only the failure→setError mapping, which is UI feedback and fine to drop
    // when the form is gone.
  });
}
