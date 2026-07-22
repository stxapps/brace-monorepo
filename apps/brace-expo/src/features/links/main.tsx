// The main pane: reads the paginated link query and renders it as a FlashList
// — the expo port of brace-web's `(app)/links/_panes/main.tsx` + its list
// layout (`_layouts/list-layout.tsx` is the canonical doc for the row anatomy
// and the staged-repaint chrome: the refresh pill, the scrolled flag, the
// sorted-field date column). Divergences here:
//
//  - One layout for now: FlashList rows (the `linksLayout` setting's list/card
//    switch arrives with the card layout).
//  - Virtualization is FlashList's own; infinite scroll is onEndReached
//    (web's virtual-index effect) — no ShowMore fallback button needed, the
//    reached-end callback is the platform contract.
//  - Pull-to-refresh triggers a sync cycle (web's overflow-menu Sync entry) —
//    the mobile idiom; it also applies any held results, since the gesture is
//    the user asking for fresh content at the top.
//  - Rows are text-first: the preview image / favicon need the file store and
//    a favicon source, which arrive with extraction support on this platform.
//  - A row press opens the URL in the system browser (web's anchor) — except in
//    bulk-edit mode (view-state `bulkEditing`), where rows grow a leading
//    checkbox and a press toggles selection instead (web's selectable rows).
//    The mode's chrome is the bottom-anchored BulkEditBar, rendered HERE (not
//    the screen) because it needs this pane's `links` for Select all and
//    display-order Copy — the same reason web's Main passes its useLinks result
//    to the toolbar. Pull-to-refresh is suspended while the mode is on (its
//    applyPending would repaint rows under the selection).
//
// The date column shows the field the rows are SORTED by (web's rationale:
// relative values must read top-to-bottom in order). Formatted by hand rather
// than Intl.RelativeTimeFormat — Hermes' Intl coverage is uneven across
// platforms, and the compact "3d" style suits the narrow column anyway.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, RefreshControl, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { Pin, RefreshCw, StickyNote } from 'lucide-react-native';

import { type LinkView, type TagItem, useSync, useTags } from '@stxapps/expo-react';
import { displayUrl, hostFromText, type LinkSortOn, type TreeNode } from '@stxapps/shared';

import { Checkbox } from '../../components/ui/checkbox';
import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';
import { BulkEditBar } from './bulk-edit-bar';
import { useLinksPage } from './page-provider';
import { useLinks } from './use-links';
import { useLinksViewState } from './view-state-provider';

// Past this many pixels we treat the pane as "scrolled away from the top", so a
// background sync is staged behind the refresh pill (see view-state-provider).
const SCROLL_TOP_THRESHOLD = 8;

// How many tag chips a row shows before collapsing the rest behind "+N" — the
// row budget stand-in for web's measured maxLines overflow.
const MAX_CHIPS = 3;

const MINUTE = 60 * 1000;
const RELATIVE_UNITS: [string, number][] = [
  ['y', 365 * 24 * 60 * MINUTE],
  ['mo', 30 * 24 * 60 * MINUTE],
  ['w', 7 * 24 * 60 * MINUTE],
  ['d', 24 * 60 * MINUTE],
  ['h', 60 * MINUTE],
  ['m', MINUTE],
];

// Compact "3d" / "2mo" for the date column: the largest unit that fits.
function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs;
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (diff >= ms) return `${Math.round(diff / ms)}${unit}`;
  }
  return 'now';
}

// Flatten the live tag tree into an id → name map, hoisted ONCE and passed to
// the rows (web's useTagMap rationale: a per-row useTags would mount one live
// read per row; tag renames must repaint immediately, never wait behind the
// refresh pill).
function useTagMap(): Map<string, string> {
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

function EmptyState({ isLoading }: { isLoading: boolean }) {
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
function RefreshPill({ show, onPress }: { show: boolean; onPress: () => void }) {
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

function LinkRow({
  link,
  pinned,
  sortOn,
  tagsById,
  selectMode,
  selected,
  onToggle,
}: {
  link: LinkView;
  pinned: boolean;
  sortOn: LinkSortOn;
  tagsById: Map<string, string>;
  // Bulk-edit mode: a leading checkbox appears and a press toggles selection
  // instead of opening the URL (web's selectable rows).
  selectMode: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const chips = link.tagIds
    .map((id) => ({ id, name: tagsById.get(id) }))
    .filter((c): c is { id: string; name: string } => c.name !== undefined);
  const overflow = chips.length - MAX_CHIPS;

  return (
    <Pressable
      onPress={() => (selectMode ? onToggle() : void Linking.openURL(link.url))}
      accessibilityState={selectMode ? { selected } : undefined}
      className="border-border active:bg-muted/50 flex-row items-center gap-3 border-b py-3 pr-2 pl-4"
    >
      {selectMode && (
        <Checkbox
          aria-label={`Select ${link.title || displayUrl(link.url)}`}
          checked={selected}
          onCheckedChange={onToggle}
          className="shrink-0"
        />
      )}
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-1.5">
          {pinned && (
            <Icon
              as={Pin}
              className="text-muted-foreground size-3.5 shrink-0"
              aria-label="Pinned"
            />
          )}
          {link.note !== undefined && link.note !== '' && (
            <Icon
              as={StickyNote}
              className="text-muted-foreground size-3.5 shrink-0"
              aria-label="Has note"
            />
          )}
          <Text numberOfLines={1} className="min-w-0 flex-1 text-sm font-medium">
            {link.title || displayUrl(link.url)}
          </Text>
        </View>
        <Text numberOfLines={1} className="text-muted-foreground text-xs">
          {hostFromText(link.url)}
        </Text>
        {chips.length > 0 && (
          <View className="mt-1 flex-row items-center gap-1 overflow-hidden">
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
        )}
      </View>
      <Text className="text-muted-foreground shrink-0 text-xs">
        {formatRelativeTime(link[sortOn])}
      </Text>
    </Pressable>
  );
}

export function Main() {
  // The resolved sort is intrinsic to the query (page-provider), so read it off
  // the same context the reads run through and hand it to the date column.
  const { query } = useLinksPage();
  const { links, pinnedCount, hasMore, showMore, isLoading, hasPending, applyPending } = useLinks();
  const { setScrolled, bulkEditing, selectedLinks, toggleSelected } = useLinksViewState();
  const { bgSyncStatus, requestSync } = useSync();
  const tagsById = useTagMap();
  const listRef = useRef<FlashListRef<LinkView>>(null);

  // FlashList compares extraData by reference to decide whether rows must
  // re-render; memoized so scroll-flag renders of this pane don't force a
  // re-render of every row, while a selection toggle (new map identity) does.
  const selectionExtra = useMemo(
    () => ({ bulkEditing, selectedLinks }),
    [bulkEditing, selectedLinks],
  );

  // Pull-to-refresh: the spinner is OUR gesture's, so it's local state armed on
  // pull and released when the cycle it kicked settles — binding it straight to
  // bgSyncStatus would spin it for background cycles the user never pulled for.
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (bgSyncStatus !== 'syncing') setRefreshing(false);
  }, [bgSyncStatus]);

  // This pane owns the scroll position; reset the shared flag on mount/unmount
  // so a stale `scrolled` can't pin `engaged` (web's layout effect, verbatim).
  useEffect(() => {
    setScrolled(false);
    return () => setScrolled(false);
  }, [setScrolled]);

  const applyAndScrollTop = () => {
    applyPending();
    listRef.current?.scrollToOffset({ offset: 0 });
  };

  return (
    <>
      {links.length === 0 ? (
        <EmptyState isLoading={isLoading} />
      ) : (
        <View className="relative min-h-0 flex-1">
          <RefreshPill show={hasPending} onPress={applyAndScrollTop} />
          <FlashList
            ref={listRef}
            data={links}
            extraData={selectionExtra}
            keyExtractor={(link) => link.path}
            renderItem={({ item, index }) => (
              <LinkRow
                link={item}
                pinned={index < pinnedCount}
                sortOn={query.sortOn}
                tagsById={tagsById}
                selectMode={bulkEditing}
                selected={selectedLinks.has(item.path)}
                onToggle={() => toggleSelected(item)}
              />
            )}
            onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > SCROLL_TOP_THRESHOLD)}
            // Infinite scroll: grow the page as the end nears. `showMore` grows the
            // read's `limit`; re-arming is implicit — FlashList only re-fires after
            // the content grows.
            onEndReached={() => {
              if (hasMore) showMore();
            }}
            onEndReachedThreshold={0.5}
            // Suspended in bulk-edit mode (see the header); `enabled` is
            // Android-only, so the control is omitted entirely instead.
            refreshControl={
              bulkEditing ? undefined : (
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => {
                    setRefreshing(true);
                    applyPending();
                    requestSync();
                  }}
                />
              )
            }
          />
        </View>
      )}
      <BulkEditBar links={links} />
    </>
  );
}
