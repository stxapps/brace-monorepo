'use client';

// The bar to the right of the sidebar. Left: the active selection's name (what
// the main pane is showing). Right: the primary actions — add, search, bulk
// edit, overflow. The list/card/table layout switch used to live here too; it
// moved to Settings → Misc (a choose-once setting with a sync/device split), so
// the topbar stays minimal.
//
// The overflow menu (More options) and bulk edit are wired up (the latter
// toggles view-state-provider's `bulkEditing` — rows become selectable and the
// main pane shows the BulkEditToolbar); search is still an `onClick` stub.

import {
  CircleAlert,
  LifeBuoy,
  Loader2,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Settings,
  SquarePen,
} from 'lucide-react';
import Link from 'next/link';

import { ALL_LABEL, flattenTree, getSyncPhase } from '@stxapps/shared';
import { useLists, useSignOut, useSync, useTags } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@stxapps/web-ui/components/ui/dropdown-menu';

import { DEFAULT_SECTION_ID } from '../../settings/sections';
import { LinkAddPopover } from '../_components/link-add-popover';
import { SearchBar } from '../_components/search-bar';
import { useLinksPage } from '../_contexts/page-provider';
import { useLinksViewState } from '../_contexts/view-state-provider';

function useSelectionLabel(): string {
  const { selection } = useLinksPage();
  const lists = useLists();
  const tags = useTags();

  if (selection.kind === 'all') return ALL_LABEL;
  // A text search or compound/multi filter has no single-axis name — title the
  // view generically rather than borrowing a stale list/tag name.
  if (selection.kind === 'none') return 'Search';
  if (selection.kind === 'list') {
    // Look the name up in the merged list tree — so a renamed system list shows
    // its override name, not the code default. Flatten since the match may be at
    // any depth.
    return flattenTree(lists).find((n) => n.item.id === selection.id)?.item.name ?? 'Unknown';
  }
  return flattenTree(tags).find((n) => n.item.id === selection.id)?.item.name ?? 'Unknown';
}

// The overflow menu behind the "More options" button: account- and session-level
// actions that don't warrant their own toolbar slot. Sign out goes through the
// useSignOut mutation (server revocation, then local wipe) rather than the bare
// auth-provider endSession primitive, which only drops the local session.
//
// The Sync item adapts to the sync phase, and a failed cycle also surfaces as a
// dot on the trigger — the topbar is the links page's only always-visible sync
// error surface (the full status card lives in Settings → Data). Only errors get
// the dot: a spinner there would flicker on every edit's sub-second cycle.
function MoreOptionsMenu() {
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

export function Topbar() {
  const label = useSelectionLabel();
  const { bulkEditing, enterBulkEdit, exitBulkEdit } = useLinksViewState();

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <h1 className="max-w-48 shrink truncate text-lg font-semibold">{label}</h1>

      <SearchBar />

      <div className="flex shrink-0 items-center gap-2">
        <LinkAddPopover />
        <Button
          variant={bulkEditing ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-label="Bulk edit"
          aria-pressed={bulkEditing}
          onClick={() => (bulkEditing ? exitBulkEdit() : enterBulkEdit())}
        >
          <SquarePen className="size-4" />
        </Button>
        <MoreOptionsMenu />
      </div>
    </header>
  );
}
