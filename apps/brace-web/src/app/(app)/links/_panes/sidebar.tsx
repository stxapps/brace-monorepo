'use client';

// Full-height left rail: brace mark at the top, then Show All, the lists (the
// My List / Archive / Trash system lists plus the user's own), and the user's
// tags as selectable filters. Clicking an entry sets the shared selection (see
// page-provider); the main pane reacts. "Show All" is the unfiltered reset.
//
// Tree rows collapse: a parent row carries a chevron as a SEPARATE hit target
// (row click = select filter, chevron = toggle), default expanded. The collapsed
// set is device-local view state, so it persists in localStorage — not the
// synced settings, and not the Dexie local-settings row (that schema'd store is
// for cross-cutting device settings like theme/layout; a migration per UI
// tweak isn't worth it). Selecting a list/tag from elsewhere (the editors'
// ListSelect, a link) auto-expands its ancestors so the active row is never
// hidden under a collapsed parent.

import { Fragment, useCallback, useEffect, useState } from 'react';
import { Archive, ChevronRight, Folder, Hash, Inbox, Layers, Settings2, Trash2 } from 'lucide-react';
import Link from 'next/link';

import {
  ALL_LABEL,
  ARCHIVE_ID,
  MY_LIST_ID,
  TRASH_ID,
  type TreeItem,
  type TreeNode,
} from '@stxapps/shared';
import { useLists, useTags } from '@stxapps/web-react';
import { BraceIcon } from '@stxapps/web-ui/components/icons/brace-icon';
import { cn } from '@stxapps/web-ui/lib/utils';

import { type Selection, useLinksPage } from '../_contexts/page-provider';

const COLLAPSED_STORAGE_KEY = 'brace:sidebar-collapsed';

// The device-local collapsed set. Starts empty (everything expanded) and loads
// from localStorage AFTER mount — reading it during render would make the
// hydration pass disagree with the server HTML. Writes are best-effort; blocked
// or corrupted storage just means starting expanded.
function useCollapsedIds() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Unreadable — keep the expanded default.
    }
  }, []);

  const persist = (next: ReadonlySet<string>) => {
    try {
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // Best-effort; the in-memory state still works for this page load.
    }
  };

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      persist(next);
      return next;
    });
  }, []);

  const expand = useCallback((ids: readonly string[]) => {
    setCollapsed((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      persist(next);
      return next;
    });
  }, []);

  return { collapsed, toggle, expand };
}

// Ids on the path from the root down to (not including) `id` — the parents that
// must be expanded for `id`'s row to be visible.
function ancestorIds<T extends TreeItem>(nodes: TreeNode<T>[], id: string): string[] {
  const walk = (ns: TreeNode<T>[], trail: string[]): string[] | null => {
    for (const n of ns) {
      if (n.item.id === id) return trail;
      const found = walk(n.children, [...trail, n.item.id]);
      if (found) return found;
    }
    return null;
  };
  return walk(nodes, []) ?? [];
}

// The icon for a list row: the system three keep their familiar marks, every
// user list is a folder.
function listIcon(id: string): React.ReactNode {
  if (id === MY_LIST_ID) return <Inbox className="size-4" />;
  if (id === ARCHIVE_ID) return <Archive className="size-4" />;
  if (id === TRASH_ID) return <Trash2 className="size-4" />;
  return <Folder className="size-4" />;
}

function isActive(current: Selection, candidate: Selection): boolean {
  if (current.kind !== candidate.kind) return false;
  if (current.kind === 'all') return true;
  return current.id === (candidate as Exclude<Selection, { kind: 'all' }>).id;
}

function NavItem({
  icon,
  label,
  selection,
  depth = 0,
  expanded,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  selection: Selection;
  // Tree nesting level — indents the row one step per level (16px, matching
  // the list pickers' indent).
  depth?: number;
  // Present only on rows with children: whether the subtree is shown, and the
  // chevron's toggle. The chevron is a sibling button, never nested in the row
  // button (a button inside a button is invalid and would fire the selection).
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { selection: current, setSelection } = useLinksPage();
  const active = isActive(current, selection);

  return (
    <div className="flex w-full items-center">
      <button
        type="button"
        onClick={() => setSelection(selection)}
        aria-current={active ? 'true' : undefined}
        style={depth > 0 ? { paddingLeft: `calc(0.5rem + ${depth * 16}px)` } : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          'hover:bg-muted',
          active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
      {onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', expanded && 'rotate-90')}
          />
        </button>
      )}
    </div>
  );
}

// One subtree → rows, parents before their children, each indented by its
// depth; collapsed parents keep their subtree unrendered. Selection is by the
// entity's own id. Generic over lists and tags — the two differ only in icon
// and selection kind.
function NavTree<T extends TreeItem & { name: string }>({
  nodes,
  iconFor,
  selectionFor,
  collapsed,
  onToggle,
}: {
  nodes: TreeNode<T>[];
  iconFor: (id: string) => React.ReactNode;
  selectionFor: (id: string) => Selection;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isCollapsed = collapsed.has(node.item.id);
        return (
          <Fragment key={node.item.id}>
            <NavItem
              icon={iconFor(node.item.id)}
              label={node.item.name}
              selection={selectionFor(node.item.id)}
              depth={node.depth}
              expanded={hasChildren ? !isCollapsed : undefined}
              onToggle={hasChildren ? () => onToggle(node.item.id) : undefined}
            />
            {hasChildren && !isCollapsed && (
              <NavTree
                nodes={node.children}
                iconFor={iconFor}
                selectionFor={selectionFor}
                collapsed={collapsed}
                onToggle={onToggle}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground/70 uppercase">
        {label}
      </h2>
      {children}
    </div>
  );
}

export function Sidebar() {
  const lists = useLists();
  const tags = useTags();
  const { selection } = useLinksPage();
  const { collapsed, toggle, expand } = useCollapsedIds();

  // Keep the active row reachable: expand its collapsed ancestors whenever the
  // selection (or the trees it lives in) changes.
  useEffect(() => {
    if (selection.kind === 'list') expand(ancestorIds(lists, selection.id));
    else if (selection.kind === 'tag') expand(ancestorIds(tags, selection.id));
  }, [selection, lists, tags, expand]);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex h-14 items-center gap-2 px-4">
        <BraceIcon className="h-6 w-auto" />
        <span className="text-base font-semibold">Brace</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem
          icon={<Layers className="size-4" />}
          label={ALL_LABEL}
          selection={{ kind: 'all' }}
        />

        {/* Lists: one ordered tree of the system three (My List / Archive / Trash)
            and the user's own lists, merged in the read layer and ordered by
            `rank`, nested by `parentId` (see use-lists). The system lists are code
            defaults (system-lists in @stxapps/shared), so they're always present;
            renaming/moving one just writes an override blob at its reserved id. */}
        <Section label="Lists">
          <NavTree
            nodes={lists}
            iconFor={listIcon}
            selectionFor={(id) => ({ kind: 'list', id })}
            collapsed={collapsed}
            onToggle={toggle}
          />

          {/* Not a filter selection — a link out to the settings section that
              creates/renames/deletes lists. Styled like the items above but it's
              an <a>, so it navigates (and Back returns here to keep organizing)
              rather than calling setSelection. */}
          <Link
            href="/settings/lists"
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              'text-muted-foreground hover:bg-muted',
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <Settings2 className="size-4" />
            </span>
            <span className="truncate">Manage lists</span>
          </Link>
        </Section>

        {/* Tags are all user-created — no system tag — so this section is empty
            until the user makes one. */}
        <Section label="Tags">
          {tags.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">No tags yet</p>
          ) : (
            <NavTree
              nodes={tags}
              iconFor={() => <Hash className="size-4" />}
              selectionFor={(id) => ({ kind: 'tag', id })}
              collapsed={collapsed}
              onToggle={toggle}
            />
          )}
        </Section>
      </nav>
    </aside>
  );
}
