'use client';

// The bar to the right of the sidebar. Left: the active selection's name (what
// the main pane is showing). Right: the primary actions — add, search, bulk
// edit, overflow. The list/card/table layout switch used to live here too; it
// moved to Settings → Miscs (a choose-once setting with a sync/device split), so
// the topbar stays minimal.
//
// The overflow menu (More options) is wired up; add/search/bulk-edit are still
// `onClick` stubs — this scaffold owns layout and state plumbing, not those flows.

import {
  LifeBuoy,
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
} from 'lucide-react';
import Link from 'next/link';

import { ALL_LABEL, flattenTree } from '@stxapps/shared';
import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@stxapps/web-ui/components/ui/dropdown-menu';

import { useLists } from '../../_hooks/use-lists';
import { useSignOut } from '../../_hooks/use-sign-out';
import { useTags } from '../../_hooks/use-tags';
import { DEFAULT_SECTION_ID } from '../../settings/sections';
import { LinkEditorPopover } from '../_components/link-editor-popover';
import { useLinksPage } from '../_contexts/page-provider';

import { useSync } from '@/contexts/sync-provider';

function useSelectionLabel(): string {
  const { selection } = useLinksPage();
  const lists = useLists();
  const tags = useTags();

  if (selection.kind === 'all') return ALL_LABEL;
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
function MoreOptionsMenu() {
  const { requestSync } = useSync();
  const signOut = useSignOut();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="More options">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => requestSync()}>
          <RefreshCw className="size-4" />
          Sync
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

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <h1 className="truncate text-lg font-semibold">{label}</h1>

      <div className="flex items-center gap-2">
        <LinkEditorPopover />
        <Button variant="ghost" size="icon-sm" aria-label="Search">
          <Search className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Bulk edit">
          <SquarePen className="size-4" />
        </Button>
        <MoreOptionsMenu />
      </div>
    </header>
  );
}
