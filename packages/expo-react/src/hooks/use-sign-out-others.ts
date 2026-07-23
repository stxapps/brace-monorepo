import { useMutation } from '@tanstack/react-query';

import { useApiClient } from '@stxapps/react';
import { signOutOthersEndpoint } from '@stxapps/shared';

// "Sign out other devices" (Settings → Account) — the expo sibling of
// web-react's hooks/use-sign-out-others.ts, verbatim (see there): revokes every
// OTHER session for the account server-side, keeping THIS device signed in — so,
// unlike useSignOut, it does NOT call endSession or touch the local session
// store. Not swallowed like sign-out's best-effort call: here success is the
// whole point of the action, so a failure must surface to the UI.
export function useSignOutOthers() {
  const api = useApiClient();

  return useMutation({
    mutationFn: async () => {
      await api.call(signOutOthersEndpoint, {});
    },
  });
}
