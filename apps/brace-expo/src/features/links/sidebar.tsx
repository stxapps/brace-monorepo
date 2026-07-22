// The links drawer's content — the expo port of brace-web's
// `(app)/links/_panes/sidebar.tsx` (canonical doc: the two collapsible
// sections — Lists as the system three + the user's own, Tags — as selectable
// filters; parent rows carry a separate chevron hit target; a final utility
// band with the Show All reset). On mobile the rail is a Drawer
// ((app)/links/_layout.tsx), so selecting an entry also closes it. Ported so
// far vs web: no filter box (worth its keep once accounts grow — arrives with
// the count gate), no lock badges/hidden-list pruning (lock-provider isn't
// ported), no Manage lists/tags links (their settings sections don't exist
// yet), and collapse state is in-memory only (web persists to localStorage;
// the device-local store can pick this up later — it resets per launch, which
// is tolerable for a tree this small).

import { Fragment, useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Archive,
  ChevronRight,
  Folder,
  Hash,
  Inbox,
  Layers,
  type LucideIcon,
  Trash2,
} from 'lucide-react-native';
import { withUniwind } from 'uniwind';

import { useLists, useTags } from '@stxapps/expo-react';
import {
  ALL_LABEL,
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

  return { collapsed, toggle };
}

// The icon for a list row: the system three keep their familiar marks, every
// user list is a folder.
function listIcon(id: string): LucideIcon {
  if (id === MY_LIST_ID) return Inbox;
  if (id === ARCHIVE_ID) return Archive;
  if (id === TRASH_ID) return Trash2;
  return Folder;
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
      </Pressable>
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
}: {
  nodes: TreeNode<T>[];
  iconFor: (id: string) => LucideIcon;
  selectionFor: (id: string) => Selection;
  onSelected: () => void;
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
              onSelected={onSelected}
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
                onSelected={onSelected}
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

export function Sidebar({ closeDrawer }: { closeDrawer: () => void }) {
  const lists = useLists();
  const tags = useTags();
  const { collapsed, toggle } = useCollapsedIds();

  return (
    <StyledSafeAreaView className="bg-background flex-1">
      <ScrollView className="flex-1 px-2 pb-4">
        {/* Lists: the system three (My List / Archive / Trash) plus the user's
            own, merged in the read layer, ordered by `rank`, nested by
            `parentId` (see use-lists). My List is the default landing
            selection (page-provider). */}
        <Section id={SECTION_LISTS} label="Lists" collapsed={collapsed} onToggle={toggle}>
          <NavTree
            nodes={lists}
            iconFor={listIcon}
            selectionFor={(id) => ({ kind: 'list', id })}
            onSelected={closeDrawer}
            collapsed={collapsed}
            onToggle={toggle}
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

        {/* Utility band: the Show All reset (the Manage lists/tags links join
            it once the settings sections exist). */}
        <View className="border-border mt-3 flex-col gap-0.5 border-t pt-2">
          <NavItem
            icon={Layers}
            label={ALL_LABEL}
            selection={{ kind: 'all' }}
            onSelected={closeDrawer}
          />
        </View>
      </ScrollView>
    </StyledSafeAreaView>
  );
}
