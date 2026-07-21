'use client';

// Dense one-row-per-link layout (the default). Window-virtualized with
// @tanstack/react-virtual: only the rows in view are mounted, so a large library
// scrolls cheaply. `ShowMore` lives outside the virtual measurement, below the
// rows, growing the page on click.

import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { displayUrl, hostFromText } from '@stxapps/shared';

import { useLinksViewState } from '../_contexts/view-state-provider';
import {
  EmptyState,
  Favicon,
  type LinkLayoutProps,
  LinkPreviewImage,
  LinkRowMenu,
  LinkRowSelect,
  LinkTagChips,
  NoteBadge,
  PinnedBadge,
  RefreshPill,
  ShowMore,
  useReportDisplayedLinkPaths,
  useTagMap,
} from './shared';

// Fixed row budget: 64×38 preview image left, then title (20) + host (16) +
// one chip line (~20, LinkTagChips' default maxLines — measured, overflow
// behind "+N") stacked in the text column, centered vertically.
const ROW_HEIGHT = 70;
// Past this many pixels we treat the pane as "scrolled away from the top", so a
// background sync is staged behind the refresh pill (see view-state-provider).
const SCROLL_TOP_THRESHOLD = 8;

// Compact, localized "added N ago" for the wide-pane date column. Intl.RelativeTimeFormat
// only formats a (count, unit) pair, so we pick the largest unit that fits and hand it the
// count; `numeric: 'auto'` yields "yesterday"/"last week" where they read better than
// "1 … ago", and `style: 'short'` keeps the column narrow ("3 days ago", "2 mo. ago").
const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, {
  numeric: 'auto',
  style: 'short',
});
const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];
function formatRelativeTime(epochMs: number): string {
  const diff = epochMs - Date.now(); // < 0 for the past
  const abs = Math.abs(diff);
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (abs >= ms) return relativeTimeFormat.format(Math.round(diff / ms), unit);
  }
  return relativeTimeFormat.format(Math.round(diff / 1000), 'second');
}

export function ListLayout({
  links,
  pinnedCount,
  hasMore,
  showMore,
  isLoading,
  hasPending,
  applyPending,
}: LinkLayoutProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setScrolled, bulkEditing, selectedLinks, toggleSelected, selectRange } =
    useLinksViewState();
  const tagsById = useTagMap();

  // This layout owns the scroll position; reset the shared flag on mount (fresh
  // at top) and unmount (so a layout switch doesn't leave it stuck true).
  useEffect(() => {
    setScrolled(false);
    return () => setScrolled(false);
  }, [setScrolled]);

  const applyAndScrollTop = () => {
    applyPending();
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const virtualizer = useVirtualizer({
    count: links.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  // Report only the displayed rows (index maps 1:1 to `links`) so extraction tracks the window.
  const rows = virtualizer.getVirtualItems();
  useReportDisplayedLinkPaths(
    links,
    rows.length ? rows[0].index : 0,
    rows.length ? rows[rows.length - 1].index : -1,
  );

  // Infinite scroll: grow the page automatically as the bottom row comes within
  // `overscan` of the viewport (the last virtualized index reaches the end).
  // `ShowMore` below stays as the keyboard/AT fallback and the "there's more" cue.
  // `showMore` grows `limit` by a fixed step per call and `rows` is a fresh array
  // every render, so we gate on the loaded count: fire once per page, re-arm only
  // once the next page's rows actually land (`links.length` changes).
  const autoLoadedLengthRef = useRef(-1);
  useEffect(() => {
    if (!hasMore) return;
    const last = rows[rows.length - 1];
    if (last && last.index >= links.length - 1 && autoLoadedLengthRef.current !== links.length) {
      autoLoadedLengthRef.current = links.length;
      showMore();
    }
  }, [rows, hasMore, links.length, showMore]);

  if (links.length === 0) return <EmptyState isLoading={isLoading} />;

  return (
    <div className="relative h-full">
      <RefreshPill show={hasPending} onClick={applyAndScrollTop} />
      <div
        ref={scrollRef}
        // `@container` so the date column below can gate on the PANE width (not the
        // viewport) — the pane widens/narrows with the collapsible sidebar without a
        // window resize, so a viewport `lg:` breakpoint would be wrong here.
        className="@container h-full overflow-y-auto"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > SCROLL_TOP_THRESHOLD)}
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {rows.map((row) => {
            const link = links[row.index];
            const pinned = row.index < pinnedCount;
            const selected = bulkEditing && selectedLinks.has(link.path);
            // In bulk-edit mode a click toggles selection instead of opening the
            // link (middle/cmd-click still opens); shift-click extends a range
            // over `links` (the displayed order). Shared by both row anchors.
            const onRowClick = bulkEditing
              ? (e: React.MouseEvent) => {
                e.preventDefault();
                if (e.shiftKey) selectRange(link, links);
                else toggleSelected(link);
              }
              : undefined;
            return (
              <div
                key={link.path}
                className={`absolute inset-x-0 flex items-center gap-3 border-b border-border pr-2 pl-4 ${
                  selected ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
              >
                {/* Bulk-edit selection sits at the row's LEADING edge (a scannable
                    checkbox column), pushing the image/text right; the row menu is
                    hidden while selecting. The thumbnail stays — it's the row's
                    at-a-glance identity — so the checkbox is inserted, not swapped in. */}
                {bulkEditing && <LinkRowSelect link={link} links={links} />}
                {/* Two sibling anchors (image, text) rather than one wrapping the
                    whole row: the tag chips are buttons and may not nest inside an
                    <a> (same rule as LinkRowMenu), so the chips sit in the text
                    column AFTER its anchor. The image anchor duplicates the text
                    one, so keyboard/AT skip it. */}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  tabIndex={-1}
                  aria-hidden
                  className="shrink-0"
                  onClick={onRowClick}
                >
                  <LinkPreviewImage
                    link={link}
                    className="h-10 w-16 rounded"
                    iconClassName="size-4 rounded"
                  />
                </a>
                <span className="min-w-0 flex-1">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block min-w-0"
                    onClick={onRowClick}
                  >
                    <span className="flex items-center gap-1.5">
                      {pinned && <PinnedBadge />}
                      {link.note && <NoteBadge note={link.note} />}
                      <span className="truncate text-sm font-medium">
                        {link.title || displayUrl(link.url)}
                      </span>
                    </span>
                    {/* size-3.5 so the icon sits inside the host line's 16px
                        budget — the row is fixed-height (ROW_HEIGHT). */}
                    <span className="flex items-center gap-1.5">
                      <Favicon host={hostFromText(link.url)} className="size-3.5 shrink-0" />
                      <span className="truncate text-xs text-muted-foreground">
                        {hostFromText(link.url)}
                      </span>
                    </span>
                  </a>
                  <LinkTagChips link={link} tagsById={tagsById} className="mt-0.5" />
                </span>
                {/* Added-date column — only when the PANE is wide enough (@lg
                    container width), so it never crowds the title on a narrow pane
                    or in the extension popup. dateTime/title carry the exact instant
                    for AT and hover; the visible text is the compact relative form. */}
                <time
                  dateTime={new Date(link.createdAt).toISOString()}
                  title={new Date(link.createdAt).toLocaleString()}
                  className="hidden shrink-0 text-xs whitespace-nowrap text-muted-foreground @xl:block"
                >
                  {formatRelativeTime(link.createdAt)}
                </time>
                {!bulkEditing && (
                  <LinkRowMenu
                    link={link}
                    pinned={pinned}
                    isFirst={row.index === 0}
                    isLast={row.index === pinnedCount - 1}
                  />
                )}
              </div>
            );
          })}
        </div>
        <ShowMore hasMore={hasMore} showMore={showMore} />
      </div>
    </div>
  );
}
