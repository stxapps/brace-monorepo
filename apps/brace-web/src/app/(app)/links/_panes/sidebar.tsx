'use client';

// Full-height left rail: brace mark at the top, an optional filter box (shown
// only once there are enough lists/tags to be worth scanning), then two
// collapsible sections — Lists (the My List / Archive / Trash system lists plus
// the user's own) and Tags — as selectable filters. Only the brand and the
// (count-gated) filter box are pinned; a final utility band — Show All (the
// unfiltered "view everything" reset) and the Manage lists / Manage tags links —
// scrolls with the trees rather than pinning, since those are low-frequency and
// pinning them was squeezing the tree's scroll room. Clicking an entry sets the
// shared selection (see page-provider); the main pane reacts.
//
// Tree rows collapse: a parent row carries a chevron on the LEFT as a SEPARATE
// hit target (row click = select filter, chevron = toggle), matching the Lists
// settings section; childless rows get a same-width spacer so their icons stay
// aligned. Section headers collapse the whole group the same way. All collapse
// state — tree ids and the two reserved section ids — is device-local view
// state, so it persists in localStorage (not the synced settings, and not the
// Dexie local-settings row, which is for cross-cutting device settings like
// theme/layout; a migration per UI tweak isn't worth it). Selecting a list/tag
// from elsewhere (the editors' ListSelect, a link) auto-expands its ancestors so
// the active row is never hidden under a collapsed parent.
//
// The filter box is a plain find-in-nav over both trees (funnel icon, not a
// magnifier): it filters which list/tag ROWS show, distinct from the topbar's
// Search, which searches saved LINK content. It's count-gated so small accounts
// never see a box that could be mistaken for link search.

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ChevronRight,
  Folder,
  Hash,
  Inbox,
  Layers,
  ListFilter,
  Settings2,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';

import {
  ALL_LABEL,
  ARCHIVE_ID,
  flattenTree,
  MY_LIST_ID,
  TRASH_ID,
  type TreeItem,
  type TreeNode,
} from '@stxapps/shared';
import { useLists, useTags } from '@stxapps/web-react';
import { BraceIcon } from '@stxapps/web-ui/components/icons/brace-icon';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { cn } from '@stxapps/web-ui/lib/utils';

import { type Selection, useLinksPage } from '../_contexts/page-provider';

const COLLAPSED_STORAGE_KEY = 'brace:sidebar-collapsed';

// Reserved collapse ids for the two section headers. Prefixed so they can't
// collide with a real list/tag id in the shared collapsed set.
const SECTION_LISTS = 'section:lists';
const SECTION_TAGS = 'section:tags';

// The filter box is chrome that only earns its keep past a handful of entries.
// Below this combined count (lists + tags) the whole tree fits at a glance, so
// we hide the box entirely — it reads as noise (or worse, as link search) when
// there's nothing to filter.
const FILTER_MIN_ITEMS = 12;

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
  showSlot = false,
}: {
  icon: React.ReactNode;
  label: string;
  selection: Selection;
  // Tree nesting level — indents the row one step per level (16px, matching
  // the list pickers' indent). Applied to the whole row so the chevron indents
  // with the label.
  depth?: number;
  // Present only on rows with children: whether the subtree is shown, and the
  // chevron's toggle. The chevron is a sibling button on the LEFT, never nested
  // in the row button (a button inside a button is invalid and would fire the
  // selection).
  expanded?: boolean;
  onToggle?: () => void;
  // In a tree, childless rows still reserve the chevron's width so their icons
  // line up under the parents' labels. Standalone rows (e.g. Show All) pass
  // false so they don't carry a phantom indent.
  showSlot?: boolean;
}) {
  const { selection: current, setSelection } = useLinksPage();
  const active = isActive(current, selection);

  return (
    <div
      className="flex w-full items-center gap-1"
      style={depth > 0 ? { paddingLeft: `${depth * 16}px` } : undefined}
    >
      {onToggle ? (
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
      ) : showSlot ? (
        <span className="size-6 shrink-0" />
      ) : null}
      <button
        type="button"
        onClick={() => setSelection(selection)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          'hover:bg-muted',
          active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
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
              showSlot
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

// A collapsible section: a disclosure-button header (chevron + uppercase label)
// over its rows. `forceOpen` overrides the stored collapse — used while
// filtering so matches are never hidden behind a collapsed header.
function Section({
  id,
  label,
  collapsed,
  onToggle,
  forceOpen = false,
  children,
}: {
  id: string;
  label: string;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  forceOpen?: boolean;
  children: React.ReactNode;
}) {
  const isCollapsed = !forceOpen && collapsed.has(id);
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={!isCollapsed}
        className="flex w-full items-center gap-1 rounded-md px-2 pt-3 pb-1 text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        <ChevronRight
          className={cn('size-3 transition-transform', !isCollapsed && 'rotate-90')}
        />
        <span className="text-xs font-semibold tracking-wide uppercase">{label}</span>
      </button>
      {!isCollapsed && children}
    </div>
  );
}

// A footer navigation link (Manage lists / tags). Not a filter selection — a
// link out to the settings section that creates/renames/deletes. Styled like
// the nav items above but it's an <a>, so it navigates (and Back returns here to
// keep organizing) rather than calling setSelection.
function FooterLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        'text-muted-foreground hover:bg-muted',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </Link>
  );
}

export function Sidebar() {
  const lists = useLists();
  const tags = useTags();
  const { selection } = useLinksPage();
  const { collapsed, toggle, expand } = useCollapsedIds();
  const [filter, setFilter] = useState('');

  // Flattened once for the count gate and the filter matches. When filtering we
  // show a flat list of matches (hierarchy and collapse ignored) — the usual
  // find-in-list behavior.
  const listRows = useMemo(() => flattenTree(lists), [lists]);
  const tagRows = useMemo(() => flattenTree(tags), [tags]);
  const showFilter = listRows.length + tagRows.length >= FILTER_MIN_ITEMS;

  const q = filter.trim().toLowerCase();
  // Only actually filter while the box is shown: if the account shrinks below
  // the gate with stale text in state, the (now hidden) box mustn't keep the
  // trees filtered.
  const filtering = showFilter && q !== '';
  const listMatches = filtering
    ? listRows.filter((n) => n.item.name.toLowerCase().includes(q))
    : [];
  const tagMatches = filtering
    ? tagRows.filter((n) => n.item.name.toLowerCase().includes(q))
    : [];

  // Keep the active row reachable: expand its collapsed ancestors whenever the
  // selection (or the trees it lives in) changes. Section collapse is left
  // alone — hiding a whole group is a deliberate choice we respect.
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

      {showFilter && (
        <div className="relative px-3 pb-1">
          <ListFilter className="pointer-events-none absolute top-1/2 left-5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter lists & tags"
            aria-label="Filter lists and tags"
            className="h-8 pl-7 text-sm"
          />
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {/* Lists: one ordered tree of the system three (My List / Archive /
            Trash) and the user's own lists, merged in the read layer and ordered
            by `rank`, nested by `parentId` (see use-lists). The system lists are
            code defaults, so they're always present; My List is the default
            landing selection (see page-provider). */}
        <Section
          id={SECTION_LISTS}
          label="Lists"
          collapsed={collapsed}
          onToggle={toggle}
          forceOpen={filtering}
        >
          {filtering ? (
            listMatches.length > 0 ? (
              listMatches.map((node) => (
                <NavItem
                  key={node.item.id}
                  icon={listIcon(node.item.id)}
                  label={node.item.name}
                  selection={{ kind: 'list', id: node.item.id }}
                />
              ))
            ) : (
              <p className="px-2 py-1 text-xs text-muted-foreground/60">No matching lists</p>
            )
          ) : (
            <NavTree
              nodes={lists}
              iconFor={listIcon}
              selectionFor={(id) => ({ kind: 'list', id })}
              collapsed={collapsed}
              onToggle={toggle}
            />
          )}
        </Section>

        {/* Tags are all user-created — no system tag — so this section is empty
            until the user makes one. */}
        <Section
          id={SECTION_TAGS}
          label="Tags"
          collapsed={collapsed}
          onToggle={toggle}
          forceOpen={filtering}
        >
          {filtering ? (
            tagMatches.length > 0 ? (
              tagMatches.map((node) => (
                <NavItem
                  key={node.item.id}
                  icon={<Hash className="size-4" />}
                  label={node.item.name}
                  selection={{ kind: 'tag', id: node.item.id }}
                />
              ))
            ) : (
              <p className="px-2 py-1 text-xs text-muted-foreground/60">No matching tags</p>
            )
          ) : tags.length === 0 ? (
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

        {/* Low-frequency utility band, scrolling with the trees rather than
            pinned (pinning it starved the tree's scroll room): the Show All
            reset, a separator, then the Manage links out to settings. The
            border-t sets it off from the Tags section above. Hidden while
            filtering — none of these are list/tag entities, so a find-in-nav
            query never matches them, and leaving them under the results reads
            as noise. Clearing the box brings the band back. */}
        {!filtering && (
          <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2">
            <NavItem icon={<Layers className="size-4" />} label={ALL_LABEL} selection={{ kind: 'all' }} />
            <div className="my-1 border-t border-border" />
            <FooterLink
              href="/settings/lists"
              icon={<Settings2 className="size-4" />}
              label="Manage lists"
            />
            <FooterLink
              href="/settings/tags"
              icon={<Settings2 className="size-4" />}
              label="Manage tags"
            />
          </div>
        )}
      </nav>
    </aside>
  );
}
