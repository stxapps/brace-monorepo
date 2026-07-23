// Pieces shared by the two link-item renderers (link-row, link-card) and the
// main pane — the expo port of brace-web's `_layouts/shared/` (link-tag-chips,
// layout-chrome, hooks, types). Smaller on purpose: the favicon / preview-image
// chain needs the file store + extraction (not on this platform yet), the row
// menu and its dialogs haven't landed, and chips are plain text (web's are
// filter buttons).

import { useMemo } from 'react';
import { Pressable, View } from 'react-native';
import { Pin, RefreshCw, StickyNote } from 'lucide-react-native';

import { type LinkView, type TagItem, useTags } from '@stxapps/expo-react';
import type { LinkSortOn, TreeNode } from '@stxapps/shared';

import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';

// The uniform contract between the main pane's FlashList and whichever item
// renderer the `linksLayout` setting picks — web's LinkLayoutProps one level
// down: there the layout owns the virtualizer so the shared surface is the
// LAYOUT; here the layout is FlashList config (main.tsx) so the shared surface
// is the ITEM. `sortOn` feeds the row's date column only — the card shows no
// date (web parity) — but stays in the contract so the renderItem call site is
// uniform across layouts.
export type LinkItemProps = {
  link: LinkView;
  pinned: boolean;
  sortOn: LinkSortOn;
  tagsById: Map<string, string>;
  // Bulk-edit mode: a checkbox appears and a press toggles selection instead of
  // opening the URL (web's selectable rows/cards).
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
};

// How many tag chips an item shows before collapsing the rest behind "+N" — the
// budget stand-in for web's measured maxLines overflow.
const MAX_CHIPS = 3;

// The item's tag-chip strip (web's LinkTagChips, minus the measured overflow and
// the chips-as-filter-buttons behavior). Renders nothing when no chip resolves,
// so callers can place it unconditionally.
export function LinkTagChips({
  link,
  tagsById,
  className = '',
}: {
  link: LinkView;
  tagsById: Map<string, string>;
  className?: string;
}) {
  const chips = link.tagIds
    .map((id) => ({ id, name: tagsById.get(id) }))
    .filter((c): c is { id: string; name: string } => c.name !== undefined);
  if (chips.length === 0) return null;
  const overflow = chips.length - MAX_CHIPS;

  return (
    <View className={`flex-row items-center gap-1 overflow-hidden ${className}`}>
      {chips.slice(0, MAX_CHIPS).map((chip) => (
        <View key={chip.id} className="bg-muted shrink rounded-full px-2 py-0.5">
          <Text numberOfLines={1} className="text-muted-foreground text-xs">
            {chip.name}
          </Text>
        </View>
      ))}
      {overflow > 0 && (
        <Text className="text-muted-foreground/70 shrink-0 text-xs">+{overflow}</Text>
      )}
    </View>
  );
}

export function PinnedBadge() {
  return (
    <Icon as={Pin} className="text-muted-foreground size-3.5 shrink-0" aria-label="Pinned" />
  );
}

// Badge only — the note text stays behind the (future) row menu / editor, web's
// rationale: an inline note would cost its line on every item, and most links
// have none.
export function NoteBadge() {
  return (
    <Icon
      as={StickyNote}
      className="text-muted-foreground size-3.5 shrink-0"
      aria-label="Has note"
    />
  );
}

export function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <View className="flex-1 items-center justify-center p-8">
      <Text className="text-muted-foreground text-sm">
        {isLoading ? 'Loading links…' : 'No links here yet.'}
      </Text>
    </View>
  );
}

// The "new updates" affordance — web's RefreshPill: floats over the list while
// a background sync's results are held back; pressing applies them and scrolls
// to top so the reorder lands where the user can see it.
export function RefreshPill({ show, onPress }: { show: boolean; onPress: () => void }) {
  if (!show) return null;

  return (
    // box-none so the strip passes touches through to the list; the pill
    // itself still receives its own.
    <View
      pointerEvents="box-none"
      className="absolute inset-x-0 top-2 z-10 flex-row justify-center"
    >
      <Pressable
        onPress={onPress}
        className="bg-primary flex-row items-center gap-2 rounded-full px-4 py-2 shadow-md"
      >
        <Icon as={RefreshCw} className="text-primary-foreground size-4" />
        <Text className="text-primary-foreground text-sm font-medium">New updates</Text>
      </Pressable>
    </View>
  );
}

// Flatten the live tag tree into an id → name map, hoisted ONCE and passed to
// the items (web's useTagMap rationale: a per-item useTags would mount one live
// read per item; tag renames must repaint immediately, never wait behind the
// refresh pill).
export function useTagMap(): Map<string, string> {
  const tree = useTags();
  return useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: TreeNode<TagItem>[]): void => {
      for (const node of nodes) {
        map.set(node.item.id, node.item.name);
        walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);
}
