// The links drawer's content — the expo port of brace-web's
// `(app)/links/_panes/sidebar.tsx` (canonical doc: the two collapsible
// sections — Lists as the system three + the user's own, Tags — as selectable
// filters; parent rows carry a separate chevron hit target; hidden-list
// pruning and the own-lock badge; a final utility band with the Show All reset
// and the Manage lists/tags links out to settings). On mobile the rail is a
// Drawer ((app)/links/_layout.tsx), so selecting an entry also closes it.
// Ported so far vs web: no filter box (worth its keep once accounts grow —
// arrives with the count gate), and collapse state is in-memory only (web
// persists to localStorage; the device-local store can pick this up later —
// it resets per launch, which is tolerable for a tree this small).

import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Archive,
  ChevronRight,
  Folder,
  Hash,
  Inbox,
  Layers,
  Lock,
  LockOpen,
  type LucideIcon,
  Settings2,
  Trash2,
} from 'lucide-react-native';
import { withUniwind } from 'uniwind';

import { useLists, useLocks, useTags } from '@stxapps/expo-react';
import {
  ALL_LABEL,
  ancestorIds,
  ARCHIVE_ID,
  MY_LIST_ID,
  TRASH_ID,
  type TreeItem,
  type TreeNode,
} from '@stxapps/shared';

import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import { cn } from '../../lib/utils';
import { type Selection, useLinksPage } from './page-provider';

const StyledSafeAreaView = withUniwind(SafeAreaView);

// Reserved collapse ids for the two section headers — prefixed so they can't
// collide with a real list/tag id in the shared collapsed set.
const SECTION_LISTS = 'section:lists';
const SECTION_TAGS = 'section:tags';

// The in-memory collapsed set (see the header for why it isn't persisted yet).
function useCollapsedIds() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Un-collapse a set of ids (a selected row's ancestors) so the active row is
  // never hidden under a collapsed parent. Returns the same set unchanged when
  // none were collapsed, so the selection effect below doesn't re-render for a
  // no-op (the common case — most selections are already visible).
  const expand = useCallback((ids: readonly string[]) => {
    setCollapsed((prev) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  return { collapsed, toggle, expand };
}

// The icon for a list row: the system three keep their familiar marks, every
// user list is a folder.
function listIcon(id: string): LucideIcon {
  if (id === MY_LIST_ID) return Inbox;
  if (id === ARCHIVE_ID) return Archive;
  if (id === TRASH_ID) return Trash2;
  return Folder;
}

// Drop the currently-hidden lists (a locked lock with hideList — lock-provider's
// closure set, so a hidden parent takes its subtree with it structurally too).
// The lists stay reachable in Settings → Lists, which is the reveal path.
function pruneHidden<T extends TreeItem>(
  nodes: TreeNode<T>[],
  hiddenIds: ReadonlySet<string>,
): TreeNode<T>[] {
  if (hiddenIds.size === 0) return nodes;
  return nodes
    .filter((node) => !hiddenIds.has(node.item.id))
    .map((node) =>
      node.children.length > 0
        ? { ...node, children: pruneHidden(node.children, hiddenIds) }
        : node,
    );
}

function isActive(current: Selection, candidate: Selection): boolean {
  if (current.kind !== candidate.kind) return false;
  if (current.kind === 'list' || current.kind === 'tag') {
    return current.id === (candidate as { id: string }).id;
  }
  return true;
}

function NavItem({
  icon,
  label,
  selection,
  onSelected,
  depth = 0,
  expanded,
  onToggle,
  showSlot = false,
  badge,
  action,
}: {
  icon: LucideIcon;
  label: string;
  selection: Selection;
  // Fired after the row commits its selection — the drawer closes on it.
  onSelected: () => void;
  // Tree nesting level — indents the row one step per level (16px, matching
  // the share picker's indent). Applied to the whole row so the chevron
  // indents with the label.
  depth?: number;
  // Present only on rows with children: whether the subtree is shown, and the
  // chevron's toggle — a SEPARATE sibling Pressable on the LEFT (row press =
  // select filter, chevron = toggle), like web.
  expanded?: boolean;
  onToggle?: () => void;
  // In a tree, childless rows still reserve the chevron's width so their icons
  // line up under the parents' labels; standalone rows (Show All) pass false.
  showSlot?: boolean;
  // Trailing marker INSIDE the row press target (the own-lock badge), after the
  // label — non-interactive.
  badge?: ReactNode;
  // Trailing INTERACTIVE control on the RIGHT, a SEPARATE sibling Pressable
  // after the row (row press = select filter, action = its own onPress), like
  // the left chevron. The list rows' "Lock now". No hover on native, so it's
  // always shown when present.
  action?: ReactNode;
}) {
  const { selection: current, setSimpleQuery } = useLinksPage();
  const active = isActive(current, selection);

  return (
    <View
      className="w-full flex-row items-center gap-1"
      style={depth > 0 ? { paddingLeft: depth * 16 } : undefined}
    >
      {onToggle ? (
        <Pressable
          onPress={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          className="size-8 shrink-0 items-center justify-center rounded-md"
        >
          <Icon
            as={ChevronRight}
            className={cn('text-muted-foreground size-4', expanded && 'rotate-90')}
          />
        </Pressable>
      ) : showSlot ? (
        <View className="size-8 shrink-0" />
      ) : null}
      <Pressable
        onPress={() => {
          setSimpleQuery(selection);
          onSelected();
        }}
        aria-current={active}
        className={cn(
          'min-w-0 flex-1 flex-row items-center gap-2 rounded-md px-2 py-2',
          active && 'bg-muted',
        )}
      >
        <Icon
          as={icon}
          className={cn('size-4 shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
        />
        <Text
          numberOfLines={1}
          className={cn(
            'min-w-0 flex-1 text-sm',
            active ? 'text-foreground font-medium' : 'text-muted-foreground',
          )}
        >
          {label}
        </Text>
        {badge && <View className="text-muted-foreground shrink-0">{badge}</View>}
      </Pressable>
      {action}
    </View>
  );
}

// One subtree → rows, parents before their children, each indented by its
// depth; collapsed parents keep their subtree unrendered. Generic over lists
// and tags — the two differ only in icon and selection kind.
function NavTree<T extends TreeItem & { name: string }>({
  nodes,
  iconFor,
  selectionFor,
  onSelected,
  collapsed,
  onToggle,
  badgeFor,
  actionFor,
}: {
  nodes: TreeNode<T>[];
  iconFor: (id: string) => LucideIcon;
  selectionFor: (id: string) => Selection;
  onSelected: () => void;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  badgeFor?: (id: string) => ReactNode;
  actionFor?: (id: string) => ReactNode;
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
              onSelected={onSelected}
              depth={node.depth}
              expanded={hasChildren ? !isCollapsed : undefined}
              onToggle={hasChildren ? () => onToggle(node.item.id) : undefined}
              showSlot
              badge={badgeFor?.(node.item.id)}
              action={actionFor?.(node.item.id)}
            />
            {hasChildren && !isCollapsed && (
              <NavTree
                nodes={node.children}
                iconFor={iconFor}
                selectionFor={selectionFor}
                onSelected={onSelected}
                collapsed={collapsed}
                onToggle={onToggle}
                badgeFor={badgeFor}
                actionFor={actionFor}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// A collapsible section: a disclosure-button header (chevron + uppercase
// label) over its rows.
function Section({
  id,
  label,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  const isCollapsed = collapsed.has(id);
  return (
    <View className="flex-col gap-0.5">
      <Pressable
        onPress={() => onToggle(id)}
        aria-expanded={!isCollapsed}
        className="w-full flex-row items-center gap-1 rounded-md px-2 pt-4 pb-1"
      >
        <Icon
          as={ChevronRight}
          className={cn('text-muted-foreground/70 size-3.5', !isCollapsed && 'rotate-90')}
        />
        <Text className="text-muted-foreground/70 text-xs font-semibold tracking-wide uppercase">
          {label}
        </Text>
      </Pressable>
      {!isCollapsed && children}
    </View>
  );
}

// A footer navigation row (Manage lists / tags). Not a filter selection — a
// plain route push out to the settings section, closing the drawer with it.
function FooterLink({
  icon,
  label,
  href,
  onSelected,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  onSelected: () => void;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        router.push(href);
        onSelected();
      }}
      className="w-full flex-row items-center gap-2 rounded-md px-2 py-2"
    >
      <Icon as={icon} className="text-muted-foreground size-4 shrink-0" />
      <Text numberOfLines={1} className="text-muted-foreground min-w-0 flex-1 text-sm">
        {label}
      </Text>
    </Pressable>
  );
}

export function Sidebar({ closeDrawer }: { closeDrawer: () => void }) {
  const lists = useLists();
  const tags = useTags();
  const { selection } = useLinksPage();
  const { hiddenListIds, listLocks, lockList } = useLocks();
  const { collapsed, toggle, expand } = useCollapsedIds();

  // What the Lists section actually renders: the tree minus the hidden lists
  // (locked + hideList). Their LINKS are excluded separately at the query
  // layer (use-links); this is the navigation half of hiding.
  const visibleLists = useMemo(() => pruneHidden(lists, hiddenListIds), [lists, hiddenListIds]);

  // Keep the active row reachable: expand its collapsed ancestors whenever the
  // selection (or the trees it lives in) changes — a selection can arrive from
  // outside the visible tree (the default landing, a deep link), so its parents
  // may be collapsed. Section collapse is left alone (web sidebar parity).
  useEffect(() => {
    if (selection.kind === 'list') expand(ancestorIds(lists, selection.id));
    else if (selection.kind === 'tag') expand(ancestorIds(tags, selection.id));
  }, [selection, lists, tags, expand]);

  // A lock marker on rows that carry their OWN engaged lock (children a lock
  // merely covers stay unmarked — the locked ancestor is the visual cue).
  const listBadge = (id: string) =>
    listLocks.get(id)?.locked ? (
      <Icon as={Lock} className="text-muted-foreground size-3.5" aria-label="Locked" />
    ) : undefined;

  // A one-tap "Lock now" for a row's OWN lock while it's currently UNLOCKED —
  // re-engages it in-memory (no password; relocking is free). Only these rows
  // get it: a locked row already shows the static badge above and its press-
  // through is the unlock pane (Main), and a row with no lock has nothing to
  // re-lock. A separate Pressable from the row, so tapping it re-locks without
  // selecting the list or closing the drawer. Re-locking a `hideList` list also
  // re-prunes it from this rail on the next coverage recompute, so it simply
  // disappears. Web parity: sidebar.tsx's hover-revealed button (native has no
  // hover, so it's always shown).
  const listAction = (id: string) => {
    const info = listLocks.get(id);
    if (!info || info.locked) return undefined;
    return (
      <Pressable
        aria-label="Lock list"
        onPress={() => lockList(id)}
        className="size-8 shrink-0 items-center justify-center rounded-md"
      >
        <Icon as={LockOpen} className="text-muted-foreground size-3.5" />
      </Pressable>
    );
  };

  return (
    <StyledSafeAreaView className="bg-background flex-1">
      <ScrollView className="flex-1 px-2 pb-4">
        {/* Lists: the system three (My List / Archive / Trash) plus the user's
            own, merged in the read layer, ordered by `rank`, nested by
            `parentId` (see use-lists). My List is the default landing
            selection (page-provider). */}
        <Section id={SECTION_LISTS} label="Lists" collapsed={collapsed} onToggle={toggle}>
          <NavTree
            nodes={visibleLists}
            iconFor={listIcon}
            selectionFor={(id) => ({ kind: 'list', id })}
            onSelected={closeDrawer}
            collapsed={collapsed}
            onToggle={toggle}
            badgeFor={listBadge}
            actionFor={listAction}
          />
        </Section>

        {/* Tags are all user-created — no system tag — so this section is
            empty until the user makes one. */}
        <Section id={SECTION_TAGS} label="Tags" collapsed={collapsed} onToggle={toggle}>
          {tags.length === 0 ? (
            <Text className="text-muted-foreground/60 px-2 py-1 text-xs">No tags yet</Text>
          ) : (
            <NavTree
              nodes={tags}
              iconFor={() => Hash}
              selectionFor={(id) => ({ kind: 'tag', id })}
              onSelected={closeDrawer}
              collapsed={collapsed}
              onToggle={toggle}
            />
          )}
        </Section>

        {/* Utility band: the Show All reset, a separator, then the Manage
            links out to settings (web's footer band). */}
        <View className="border-border mt-3 flex-col gap-0.5 border-t pt-2">
          <NavItem
            icon={Layers}
            label={ALL_LABEL}
            selection={{ kind: 'all' }}
            onSelected={closeDrawer}
          />
          <View className="border-border my-1 border-t" />
          <FooterLink
            icon={Settings2}
            label="Manage lists"
            href="/settings/lists"
            onSelected={closeDrawer}
          />
          <FooterLink
            icon={Settings2}
            label="Manage tags"
            href="/settings/tags"
            onSelected={closeDrawer}
          />
        </View>
      </ScrollView>
    </StyledSafeAreaView>
  );
}
