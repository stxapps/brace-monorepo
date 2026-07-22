'use client';

// The bar to the right of the sidebar. Left: the active selection's name (what
// the main pane is showing). Right: the primary actions — add, search, bulk
// edit, overflow (more-options-menu.tsx). The list/card layout switch used to
// live here too; it moved to Settings → Misc (a choose-once setting with a
// sync/device split), so the topbar stays minimal.
//
// The overflow menu (More options) and bulk edit are wired up (the latter
// toggles view-state-provider's `bulkEditing` — rows become selectable and the
// main pane shows the BulkEditToolbar); search is still an `onClick` stub.

import { SquarePen } from 'lucide-react';

import { ALL_LABEL, flattenTree } from '@stxapps/shared';
import { useLists, useTags } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

import { LinkAddPopover } from '../_components/link-add-popover';
import { MoreOptionsMenu } from '../_components/more-options-menu';
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
