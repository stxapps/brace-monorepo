// Pieces shared by the two link-item renderers (link-row, link-card) and the
// main pane — the expo port of brace-web's `_layouts/shared/` (link-tag-chips,
// layout-chrome, hooks, types). Smaller on purpose: the favicon / preview-image
// chain needs the file store + extraction (not on this platform yet), and the
// edit dialog hasn't landed (the row menu — link-row-menu.tsx — omits its Edit
// / View note items meanwhile).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Pin, RefreshCw, StickyNote } from 'lucide-react-native';

import { type LinkView, type TagItem, useTags } from '@stxapps/expo-react';
import type { LinkSortOn, TreeNode } from '@stxapps/shared';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import { useLinksPage } from './page-provider';
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

// How many tag chips an item shows before collapsing the rest behind "+N" — the
// budget stand-in for web's measured maxLines overflow.
const MAX_CHIPS = 3;

const TAG_CHIP_CLASS = 'bg-muted active:bg-muted/70 rounded-full px-2 py-0.5';

// The item's tag-chip strip — web's LinkTagChips, minus the measured overflow
// (MAX_CHIPS above stands in): one pressable chip per tag, in the link's own
// `tagIds` order, each navigating to that tag's view via setSimpleQuery — the
// same canonical `/links?tag=…` URL the drawer writes. In bulk-edit mode a chip
// toggles the item's selection instead, matching the item press. Ids the map
// doesn't know (a tag deleted / not yet synced) are skipped; no tags renders
// nothing, so callers can place it unconditionally.
//
// The chips sit INSIDE the item's Pressable — fine on this platform: RN's
// responder hands the touch to the innermost pressable, so a chip press never
// also fires the item (web needed the chips outside the row's <a> instead).
// "+N" opens the overflow tags as a dropdown (the popover stand-in — same
// portaled content, same engagement reporting via useEngagedOpen); in bulk-edit
// mode it toggles selection like every other chip (no menu), web verbatim.
export function LinkTagChips({
  link,
  tagsById,
  className = '',
}: {
  link: LinkView;
  tagsById: Map<string, string>;
  className?: string;
}) {
  const { setSimpleQuery } = useLinksPage();
  const { bulkEditing, toggleSelected } = useLinksViewState();
  const [, onOverflowOpenChange] = useEngagedOpen();

  const chips = link.tagIds
    .map((id) => ({ id, name: tagsById.get(id) }))
    .filter((c): c is { id: string; name: string } => c.name !== undefined);
  if (chips.length === 0) return null;
  const overflow = chips.slice(MAX_CHIPS);

  const onTagPress = (id: string) =>
    bulkEditing ? toggleSelected(link) : setSimpleQuery({ kind: 'tag', id });

  return (
    <View className={`flex-row items-center gap-1 overflow-hidden ${className}`}>
      {chips.slice(0, MAX_CHIPS).map((chip) => (
        <Pressable
          key={chip.id}
          onPress={() => onTagPress(chip.id)}
          className={`shrink ${TAG_CHIP_CLASS}`}
        >
          <Text numberOfLines={1} className="text-muted-foreground text-xs">
            {chip.name}
          </Text>
        </Pressable>
      ))}
      {overflow.length > 0 &&
        (bulkEditing ? (
          <Pressable onPress={() => toggleSelected(link)} className={`shrink-0 ${TAG_CHIP_CLASS}`}>
            <Text className="text-muted-foreground text-xs">+{overflow.length}</Text>
          </Pressable>
        ) : (
          <DropdownMenu onOpenChange={onOverflowOpenChange}>
            <DropdownMenuTrigger asChild>
              <Pressable
                aria-label={`Show ${overflow.length} more ${overflow.length === 1 ? 'tag' : 'tags'}`}
                className={`shrink-0 ${TAG_CHIP_CLASS}`}
              >
                <Text className="text-muted-foreground text-xs">+{overflow.length}</Text>
              </Pressable>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-w-64">
              {overflow.map((chip) => (
                <DropdownMenuItem key={chip.id} onPress={() => onTagPress(chip.id)}>
                  <Text numberOfLines={1}>{chip.name}</Text>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
    </View>
  );
}

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
