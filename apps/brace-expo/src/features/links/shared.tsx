// Pieces shared by the two link-item renderers (link-row, link-card) and the
// main pane — the expo port of brace-web's `_layouts/shared/` grab-bag
// (layout-chrome, hooks, types, the badges; the tag chips, the row menu, and
// the preview-image chain have their own files on both platforms —
// link-tag-chips.tsx, link-row-menu.tsx, link-media.tsx).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Pin, RefreshCw, StickyNote } from 'lucide-react-native';

import { type LinkView, type TagItem, useTags } from '@stxapps/expo-react';
import type { LinkSortOn, TreeNode } from '@stxapps/shared';

import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import { useLinksViewState } from './view-state-provider';

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
  // At the pinned section's ends — the row menu disables the Move up/down that
  // would fall off them (web's LinkRowMenu props). Meaningful only when
  // `pinned`; false otherwise.
  isFirst: boolean;
  isLast: boolean;
  sortOn: LinkSortOn;
  tagsById: Map<string, string>;
  // Bulk-edit mode: a checkbox appears and a press toggles selection instead of
  // opening the URL (web's selectable rows/cards).
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
};

export function PinnedBadge() {
  return <Icon as={Pin} className="text-muted-foreground size-3.5 shrink-0" aria-label="Pinned" />;
}

// Badge only — the note text stays behind the (future) edit dialog (web's "View
// note" menu item, which needs it), web's rationale: an inline note would cost
// its line on every item, and most links have none.
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

// Open state for an item-anchored overlay (the row menu, its Move-to dialog,
// the tag-overflow menu), reporting open/close into the hoisted engagement
// count (setMenuOpen) so a background sync won't repaint the item — moving or
// unmounting the trigger — while the overlay is open (web's useEngagedOpen,
// verbatim). Tracks its own open flag so an unmount-while-open (e.g. a layout
// switch) releases the count instead of leaking it and pinning `engaged` true
// forever; idempotent on repeated same-state calls — the count is shared, so a
// stray close must not decrement another overlay's increment. One divergence:
// @rn-primitives' dropdown Root is uncontrolled on native (no `open` prop), so
// menu callers pass only the handler to onOpenChange and ignore the returned
// state — it still exists for the callers that do control (the Move-to dialog).
export function useEngagedOpen(): [boolean, (open: boolean) => void] {
  const { setMenuOpen } = useLinksViewState();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  useEffect(
    () => () => {
      if (openRef.current) setMenuOpen(false);
    },
    [setMenuOpen],
  );
  const handleOpenChange = (nextOpen: boolean) => {
    if (openRef.current === nextOpen) return;
    openRef.current = nextOpen;
    setOpen(nextOpen);
    setMenuOpen(nextOpen);
  };
  return [open, handleOpenChange];
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
