'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usernameAvailableQueryOptions } from '@stxapps/react';
import type { CreateAccountValues } from '@stxapps/shared';

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

      // Step 2: derive the account via client KDF (@stxapps/web-crypto, future)
      //   → key pair.
      // Step 3: sign a challenge and POST it to exchange for a session id.
      // Left stubbed until the crypto package and session endpoint land.
      console.log('create account', values);

      // onSuccess will land the returned session in the cache / auth context so
      // the rest of the app rerenders — the equivalent of dispatching to update
      // the store.
    },
  });
}
