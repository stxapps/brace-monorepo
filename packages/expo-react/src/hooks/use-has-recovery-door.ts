import { useQuery } from '@tanstack/react-query';

import { useApiClient } from '@stxapps/react';
import { ApiError, recoveryDoorEndpoint } from '@stxapps/shared';

import { useAuth } from '../contexts/auth-provider';

// Does the signed-in account have a recovery door? — the expo sibling of
// web-react's hooks/use-has-recovery-door.ts, verbatim (see there): powers the
// "no recovery set" nudge in Settings → Account. Reuses the pre-auth
// recovery-door fetch and reads existence from the status: 200 = a door is set,
// 404 = it was skipped at create (or never added). Invalidated when a recovery
// code is (re)generated so the nudge disappears immediately.
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
