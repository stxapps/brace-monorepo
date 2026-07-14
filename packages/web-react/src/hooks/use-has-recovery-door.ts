'use client';

import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '@stxapps/react';
import { ApiError, recoveryDoorEndpoint } from '@stxapps/shared';

import { useAuth } from '../contexts/auth-provider';

// Does the signed-in account have a recovery door? Powers the "no recovery set"
// nudge in Settings → Account. We reuse the pre-auth recovery-door fetch (it only
// ever serves this user's own ciphertext) and read existence from the status: a
// 200 means a door is set, a 404 means it was skipped at create (or never added).
// Query, not mutation — it's a cacheable read; it invalidates when a recovery code
// is (re)generated so the nudge disappears immediately.
export function useHasRecoveryDoor() {
  const api = useApiClient();
  const { username } = useAuth();

  return useQuery({
    queryKey: ['recovery-door-exists', username],
    enabled: !!username,
    queryFn: async (): Promise<boolean> => {
      // `enabled` gates this on a non-null username; the guard just narrows the type.
      if (!username) return false;
      try {
        await api.call(recoveryDoorEndpoint, { username });
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return false;
        throw err;
      }
    },
  });
}
