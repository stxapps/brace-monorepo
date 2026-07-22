'use client';

// The overflow menu behind the topbar's "More options" button: account- and
// session-level actions that don't warrant their own toolbar slot. Sign out goes
// through the useSignOut mutation (server revocation, then local wipe) rather
// than the bare auth-provider endSession primitive, which only drops the local
// session.
//
// The Sync item adapts to the sync phase, and a failed cycle also surfaces as a
// dot on the trigger — the topbar is the links page's only always-visible sync
// error surface (the full status card lives in Settings → Data). Only errors get
// the dot: a spinner there would flicker on every edit's sub-second cycle.

import {
  CircleAlert,
  LifeBuoy,
  Loader2,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Settings,
} from 'lucide-react';
import Link from 'next/link';

import { getSyncPhase } from '@stxapps/shared';
import { useSignOut, useSync } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@stxapps/web-ui/components/ui/dropdown-menu';

import { DEFAULT_SECTION_ID } from '../../settings/sections';

export function MoreOptionsMenu() {
  const { storeStatus, bgSyncStatus, requestSync } = useSync();
  const signOut = useSignOut();
  const phase = getSyncPhase(storeStatus, bgSyncStatus);
  // Rendered inside InitialSyncGate, so storeStatus is never 'error' here —
  // 'initial-error' and its retryInitialSync belong to the gate's own screen.
  const syncError = phase === 'cycle-error';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={syncError ? 'More options (sync failed)' : 'More options'}
        >
          <MoreHorizontal className="size-4" />
          {syncError && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 size-1.5 rounded-full bg-destructive"
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          onSelect={(e) => {
            // Keep the menu open: the Syncing… → settled transition on this item
            // IS the click's feedback (requestSync coalesces, so re-clicks are safe).
            e.preventDefault();
            requestSync();
          }}
        >
          {phase === 'syncing' ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Syncing…
            </>
          ) : syncError ? (
            <>
              <CircleAlert className="size-4 text-destructive" />
              Sync failed — Retry
            </>
          ) : (
            <>
              <RefreshCw className="size-4" />
              Sync
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/settings/${DEFAULT_SECTION_ID}`}>
            <Settings className="size-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/support" target="_blank" rel="noopener noreferrer">
            <LifeBuoy className="size-4" />
            Support
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={signOut.isPending}
          onSelect={() => signOut.mutate()}
        >
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
