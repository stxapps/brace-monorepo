'use client';

// The searchable list command shared by every "pick a list" surface: ListSelect
// wraps it in a popover for the editors, and the link row menu's "Move to"
// embeds it in a dropdown submenu — one implementation of the tree rendering,
// search behavior, and path labels instead of per-surface drift.
//
// Past SEARCH_THRESHOLD items a filter input appears at the top. Two render
// modes, because filtering breaks indentation's meaning (a depth-3 match would
// float with no visible parent): an empty query shows the whole indented tree
// with per-level guide lines; a non-empty query shows flat matches labelled
// with their ancestor path ("Work / Cooking / Recipes"). Query state lives
// here, so a host that unmounts its content on close (popover, submenu) resets
// the search for free.

import { useMemo, useState } from 'react';

import type { TreeNode } from '@stxapps/shared';
import { type ListItem, useLists } from '@stxapps/web-react';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@stxapps/web-ui/components/ui/command';
import { cn } from '@stxapps/web-ui/lib/utils';

// Below this many lists, scrolling beats a filter box — don't render one.
const SEARCH_THRESHOLD = 10;

export type ListRow = { item: ListItem; depth: number; ancestors: string[] };

// The live list tree flattened depth-first like flattenTree, but carrying each
// row's ancestor names — the path shown on filtered rows and on ListSelect's
// trigger. `excludeIds` drops rows entirely (Trash in the editors — a leaf, so
// no children get orphaned); hosts that need "visible but not selectable" use
// ListCommand's `disabledIds` instead.
export function useListRows(excludeIds?: readonly string[]): ListRow[] {
  const lists = useLists();

  return useMemo(() => {
    const out: ListRow[] = [];
    const walk = (nodes: TreeNode<ListItem>[], ancestors: string[]): void => {
      for (const node of nodes) {
        if (!excludeIds?.includes(node.item.id)) {
          out.push({ item: node.item, depth: node.depth, ancestors });
        }
        walk(node.children, [...ancestors, node.item.name]);
      }
    };
    walk(lists, []);
    return out;
  }, [lists, excludeIds]);
}

export function ListCommand({
  value,
  onSelect,
  excludeIds,
  disabledIds,
  className,
}: {
  // The current list id — its row gets the check mark.
  value?: string;
  onSelect: (listId: string) => void;
  // Rows to leave out entirely (see useListRows).
  excludeIds?: readonly string[];
  // Rows kept visible but not selectable — e.g. the link's current list in the
  // row menu's Move to, so the tree's shape (and the user's bearings) stays
  // intact while ruling out a no-op move.
  disabledIds?: readonly string[];
  className?: string;
}) {
  const rows = useListRows(excludeIds);
  const [query, setQuery] = useState('');

  const searchable = rows.length > SEARCH_THRESHOLD;
  const trimmed = query.trim().toLowerCase();
  const filtering = searchable && trimmed.length > 0;
  const visibleRows = filtering
    ? rows.filter(({ item }) => item.name.toLowerCase().includes(trimmed))
    : rows;

  return (
    /* Without an input, cmdk's arrow-key nav needs the root focusable. */
    <Command
      shouldFilter={false}
      tabIndex={searchable ? undefined : 0}
      className={cn('rounded-2xl outline-none', className)}
    >
      {searchable && (
        <CommandInput placeholder="Search lists…" value={query} onValueChange={setQuery} />
      )}
      <CommandList>
        <CommandEmpty>No lists found.</CommandEmpty>
        {visibleRows.map(({ item, depth, ancestors }) => (
          <CommandItem
            key={item.id}
            value={item.id}
            disabled={disabledIds?.includes(item.id)}
            data-checked={item.id === value}
            // cmdk may normalize `value`, so pass the id via closure.
            onSelect={() => onSelect(item.id)}
          >
            {!filtering && depth > 0 && (
              // Guide lines, one per level; -my-2 runs them through the
              // row padding so they connect across adjacent rows.
              <span aria-hidden className="-my-2 flex self-stretch">
                {Array.from({ length: depth }, (_, i) => (
                  <span key={i} className="w-4 border-l border-border" />
                ))}
              </span>
            )}
            <span className="truncate">
              {filtering && ancestors.length > 0 && (
                <span className="text-muted-foreground">
                  {ancestors.join(' / ')}
                  {' / '}
                </span>
              )}
              {item.name}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}
