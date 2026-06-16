'use client';

// The Lists settings section: manage and organize the user's lists. Renders the
// same ordered tree the sidebar shows (useLists), but as editable rows — inline
// rename, reorder among siblings, reparent ("move to"), and delete — plus a
// create row at the top. Every edit goes through useListMutations, which writes
// exactly one list file per op (rank/parentId model), so this page never has to
// reason about the sync layer; it just renders the live tree and fires intents.
//
// Drag-and-drop is intentionally NOT here yet: every reorder/reparent is a
// button (up/down + a "move to" submenu), so the page is fully usable and
// keyboard-accessible. Drag is a later enhancement layered over the same
// mutations. Secondary actions live behind a per-row kebab menu rather than a
// width-measured overflow, so rows stay stable at any container width.

import { useState } from 'react';
import {
  Archive,
  ArrowDownAZ,
  ArrowDownZA,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CornerUpRight,
  Folder,
  Inbox,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from 'lucide-react';

import { ARCHIVE_ID, isSystemListId, MY_LIST_ID, TRASH_ID } from '@stxapps/shared';
import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@stxapps/web-ui/components/ui/dropdown-menu';
import { Input } from '@stxapps/web-ui/components/ui/input';

import { useListMutations } from '../../../_hooks/use-list-mutations';
import { useLists } from '../../../_hooks/use-lists';
import { childrenOf, flattenTree, forbiddenParentIds, type ListRow } from './tree-helpers';

import type { ListItem } from '@/data/queries';

const NO_COLLAPSE: ReadonlySet<string> = new Set();

type SortDir = 'asc' | 'desc';

// Alphabetical by name (case-insensitive via localeCompare), tie-broken by id so
// the order is deterministic and stable across re-sorts. `desc` flips the name
// comparison only.
function sortedByName<T extends { name: string; id: string }>(items: T[], dir: SortDir): T[] {
  return [...items].sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return dir === 'asc' ? byName : -byName;
    return a.id.localeCompare(b.id);
  });
}

function listIcon(id: string): React.ReactNode {
  if (id === MY_LIST_ID) return <Inbox className="size-4" />;
  if (id === ARCHIVE_ID) return <Archive className="size-4" />;
  if (id === TRASH_ID) return <Trash2 className="size-4" />;
  return <Folder className="size-4" />;
}

// Inline rename. Uncontrolled so typing never round-trips through the store;
// commits on blur and Enter, reverts on Escape. `key`ed by the stored name in the
// parent so an external rename (another device) refreshes the field.
function RenameField({ list, onRename }: { list: ListItem; onRename: (name: string) => void }) {
  return (
    <Input
      defaultValue={list.name}
      aria-label="List name"
      className="h-8 border-transparent bg-transparent px-2 hover:border-border focus-visible:bg-background"
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape') {
          e.currentTarget.value = list.name;
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => onRename(e.currentTarget.value)}
    />
  );
}

// The per-row overflow menu: reorder within siblings, reparent, delete. Move-to
// lists every candidate parent (root + lists that aren't this one, its subtree,
// or a no-children container). Delete is hidden for system lists.
function RowActions({
  row,
  candidates,
  onMoveUp,
  onMoveDown,
  onMoveTo,
  onSortChildren,
  onDelete,
}: {
  row: ListRow;
  candidates: ListRow[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveTo: (parentId: string | null) => void;
  onSortChildren: (dir: SortDir) => void;
  onDelete: () => void;
}) {
  const isFirst = row.index === 0;
  const isLast = row.index === row.siblings.length - 1;
  const deletable = !isSystemListId(row.item.id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="List actions">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={isFirst} onSelect={onMoveUp}>
          <ChevronUp className="size-4" /> Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isLast} onSelect={onMoveDown}>
          <ChevronDown className="size-4" /> Move down
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CornerUpRight className="size-4" /> Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem disabled={row.parentId === null} onSelect={() => onMoveTo(null)}>
              Top level
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {candidates.map((c) => (
              <DropdownMenuItem
                key={c.item.id}
                disabled={c.item.id === row.parentId}
                onSelect={() => onMoveTo(c.item.id)}
              >
                <span style={{ paddingLeft: `${c.depth * 0.75}rem` }} className="truncate">
                  {c.item.name}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {row.hasChildren && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowUpDown className="size-4" /> Sort sub-lists
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => onSortChildren('asc')}>
                <ArrowDownAZ className="size-4" /> A → Z
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSortChildren('desc')}>
                <ArrowDownZA className="size-4" /> Z → A
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {deletable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-4" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The create-a-list row pinned at the top. The plus turns into a cancel once the
// field is active (focused or non-empty); a confirm (check) appears on the right.
// Confirming prepends the new list to the root group, ready to be organized.
function CreateRow({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const active = focused || value !== '';

  const reset = () => {
    setValue('');
    setFocused(false);
  };
  const confirm = async () => {
    if (value.trim() === '') return reset();
    await onCreate(value);
    setValue('');
  };

  return (
    <div className="flex items-center gap-1 border-b border-border px-1 py-1.5">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={active ? 'Cancel' : 'New list'}
        onMouseDown={(e) => {
          // mousedown (not click) so the field's blur doesn't fire first and
          // clear `active` before we can cancel.
          if (active) {
            e.preventDefault();
            reset();
          }
        }}
      >
        {active ? <X className="size-4" /> : <Plus className="size-4" />}
      </Button>
      <Input
        value={value}
        placeholder="New list"
        aria-label="New list name"
        className="h-8 border-transparent bg-transparent px-2 focus-visible:bg-background"
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void confirm();
          else if (e.key === 'Escape') reset();
        }}
      />
      {active && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Create list"
          onMouseDown={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <Check className="size-4" />
        </Button>
      )}
    </div>
  );
}

export function ListsSection() {
  const lists = useLists();
  const { create, rename, move, remove, reorder } = useListMutations();

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(NO_COLLAPSE);
  const [error, setError] = useState<string | null>(null);

  const rows = flattenTree(lists, collapsed);
  // The move-to candidate list ignores collapse — every list is a valid target
  // whether or not its row is shown.
  const allRows = flattenTree(lists, NO_COLLAPSE);

  const run = (op: Promise<unknown>) => {
    setError(null);
    void op.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const siblingsWithout = (row: ListRow) =>
    row.siblings.filter((sibling) => sibling.id !== row.item.id);

  // Sort one sibling group (root when parentId is null) alphabetically. reorder
  // writes only the rows whose rank changes, so re-sorting an ordered group is a
  // no-op.
  const sortGroup = (parentId: string | null, dir: SortDir) =>
    run(reorder(sortedByName(childrenOf(lists, parentId), dir)));

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="text-xl font-semibold">Lists</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        Create, rename, reorder, and nest your lists. My List, Archive, and Trash are built in — you
        can rename and reorder them, but not delete them.
      </p>

      {error && (
        <p className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mb-2 flex justify-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm">
              <ArrowUpDown className="size-4" /> Sort
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => sortGroup(null, 'asc')}>
              <ArrowDownAZ className="size-4" /> A → Z
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => sortGroup(null, 'desc')}>
              <ArrowDownZA className="size-4" /> Z → A
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="rounded-lg border border-border">
        <CreateRow
          onCreate={async (name) => {
            await create(name, null, childrenOf(lists, null), 0);
          }}
        />

        <ul>
          {rows.map((row) => {
            const forbidden = forbiddenParentIds(lists, row.item.id);
            const candidates = allRows.filter((c) => !forbidden.has(c.item.id));
            return (
              <li
                key={row.item.id}
                className="flex items-center gap-1 px-1 py-1 not-last:border-b not-last:border-border/60"
                style={{ paddingLeft: `${0.25 + row.depth * 1.25}rem` }}
              >
                {row.hasChildren ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={collapsed.has(row.item.id) ? 'Expand' : 'Collapse'}
                    onClick={() => toggle(row.item.id)}
                  >
                    {collapsed.has(row.item.id) ? (
                      <ChevronRight className="size-4" />
                    ) : (
                      <ChevronDown className="size-4" />
                    )}
                  </Button>
                ) : (
                  <span className="size-8 shrink-0" />
                )}

                <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                  {listIcon(row.item.id)}
                </span>

                <div className="min-w-0 flex-1">
                  <RenameField
                    key={`${row.item.id}:${row.item.name}`}
                    list={row.item}
                    onRename={(name) => run(rename(row.item, name))}
                  />
                </div>

                <RowActions
                  row={row}
                  candidates={candidates}
                  onMoveUp={() =>
                    run(move(row.item, row.parentId, siblingsWithout(row), row.index - 1))
                  }
                  onMoveDown={() =>
                    run(move(row.item, row.parentId, siblingsWithout(row), row.index + 1))
                  }
                  onMoveTo={(parentId) => {
                    const dest = childrenOf(lists, parentId).filter((s) => s.id !== row.item.id);
                    run(move(row.item, parentId, dest, dest.length));
                  }}
                  onSortChildren={(dir) => sortGroup(row.item.id, dir)}
                  onDelete={() => run(remove(row.item))}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
