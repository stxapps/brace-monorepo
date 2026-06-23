import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ApiClientProvider } from '@stxapps/react';
import { AuthProvider, ExternalSyncProvider } from '@stxapps/web-react';
import { ThemeProvider, type ThemeStorage } from '@stxapps/web-ui/contexts/theme-provider';

import { api } from '@/utils/api';
import { sendMessage } from '@/utils/messages';

// The popup's provider tree — brace-web's inner-layout, minus Serwist and the sync
// ENGINE: QueryClient → ApiClient → Auth → (External)Sync → Theme.
//
// The sync engine runs in the background service worker (a separate JS context — see
// Phase 4), so the popup does NOT mount SyncProvider. Instead it mounts
// ExternalSyncProvider, whose `requestSync` just messages the background to run a
// cycle. This satisfies the editor hooks' `useSync()` (useLinkMutations &c. call
// requestSync after each local write) without the popup double-running the sync.
export function Providers({
  children,
  themeStorage,
}: {
  children: ReactNode;
  themeStorage: ThemeStorage;
}) {
  // One QueryClient per popup session, created lazily so it isn't shared across
  // renders. ApiClientProvider hands the shared hooks the mode-configured client.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={api}>
        <AuthProvider>
          <ExternalSyncProvider
            requestSync={() => {
              void sendMessage({ type: 'KICK_SYNC' });
            }}
          >
            <ThemeProvider storage={themeStorage}>{children}</ThemeProvider>
          </ExternalSyncProvider>
        </AuthProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
