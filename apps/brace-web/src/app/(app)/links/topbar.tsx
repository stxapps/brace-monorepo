'use client';

// The bar to the right of the sidebar. Left: the active selection's name (what
// the main pane is showing). Right: the primary actions — add, search, bulk
// edit, overflow — plus the list/card/table layout switch.
//
// Actions are wired to `onClick` stubs for now; this scaffold owns layout and
// state plumbing, not the add/search/bulk flows.

import { LayoutGrid, List, MoreHorizontal, Plus, Search, SquarePen, Table } from 'lucide-react';

import { ALL_ID, SYSTEM_LIST_NAMES } from '@stxapps/shared';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { cn } from '@stxapps/web-ui/lib/utils';

import { useLists } from './hooks/use-lists';
import { useTags } from './hooks/use-tags';
import { type LayoutMode, useLinksPage } from './links-page-provider';

const LAYOUT_OPTIONS: { mode: LayoutMode; label: string; icon: React.ReactNode }[] = [
  { mode: 'list', label: 'List layout', icon: <List className="size-4" /> },
  { mode: 'card', label: 'Card layout', icon: <LayoutGrid className="size-4" /> },
  { mode: 'table', label: 'Table layout', icon: <Table className="size-4" /> },
];

function useSelectionLabel(): string {
  const { selection } = useLinksPage();
  const lists = useLists();
  const tags = useTags();

  if (selection.kind === 'all') return SYSTEM_LIST_NAMES[ALL_ID];
  if (selection.kind === 'list') {
    // System lists name themselves from the constants; user lists from the store.
    return (
      SYSTEM_LIST_NAMES[selection.id] ?? lists.find((l) => l.id === selection.id)?.name ?? 'Unknown'
    );
  }
  return tags.find((t) => t.id === selection.id)?.name ?? 'Unknown';
}

function LayoutSwitch() {
  const { layoutMode, setLayoutMode } = useLinksPage();
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {LAYOUT_OPTIONS.map(({ mode, label, icon }) => (
        <Button
          key={mode}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={layoutMode === mode}
          onClick={() => setLayoutMode(mode)}
          className={cn('rounded', layoutMode === mode && 'bg-muted text-foreground')}
        >
          {icon}
        </Button>
      ))}
    </div>
  );
}

export function Topbar() {
  const label = useSelectionLabel();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <h1 className="truncate text-lg font-semibold">{label}</h1>

      <div className="flex items-center gap-2">
        <LayoutSwitch />

        {/* Action handlers are intentionally unwired — this scaffold owns layout
            and state plumbing, not the add/search/bulk/overflow flows. */}
        <Button variant="default" size="sm">
          <Plus className="size-4" />
          Add
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Search">
          <Search className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Bulk edit">
          <SquarePen className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="More options">
          <MoreHorizontal className="size-4" />
        </Button>
      </div>
    </header>
  );
}
