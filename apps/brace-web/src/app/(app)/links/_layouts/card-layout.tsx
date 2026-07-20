'use client';

// Grid-of-previews layout. Virtualized by ROW (each virtual item is a row of
// `COLUMNS` cards) — the simplest way to virtualize a uniform grid: divide the
// link list into chunks and lay each chunk out with a flex/grid row. Card height
// is fixed so the row estimate stays exact.

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
  PinnedBadge,
  RefreshPill,
  ShowMore,
  useReportDisplayedLinkPaths,
  useTagMap,
} from './shared';

const COLUMNS = 3;
// Fixed card budget: preview banner (112) + p-3 text block (host 20 + gap 8 +
// two title lines 40 + padding 24) + up to two chip lines + pb-3 (56 —
// LinkTagChips maxLines={2} measures the fit, so the block never exceeds two
// lines) + the row's pb-4 (16). Cards with less content keep the height — the
// anchor's flex-1 absorbs the slack — so the row estimate stays exact.
const ROW_HEIGHT = 280;
const SCROLL_TOP_THRESHOLD = 8;

export function CardLayout({
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
  const rowCount = Math.ceil(links.length / COLUMNS);

  useEffect(() => {
    setScrolled(false);
    return () => setScrolled(false);
  }, [setScrolled]);

  const applyAndScrollTop = () => {
    applyPending();
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  // Virtual items are ROWS of COLUMNS cards, so the displayed LINK range is the first row's
  // first card through the last row's last card (the hook clamps the tail to `links.length`).
  const rows = virtualizer.getVirtualItems();
  useReportDisplayedLinkPaths(
    links,
    rows.length ? rows[0].index * COLUMNS : 0,
    rows.length ? rows[rows.length - 1].index * COLUMNS + COLUMNS - 1 : -1,
  );

  if (links.length === 0) return <EmptyState isLoading={isLoading} />;

  return (
    <div className="relative h-full">
      <RefreshPill show={hasPending} onClick={applyAndScrollTop} />
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto p-4"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > SCROLL_TOP_THRESHOLD)}
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {rows.map((virtualRow) => {
            const start = virtualRow.index * COLUMNS;
            const rowLinks = links.slice(start, start + COLUMNS);
            return (
              <div
                key={virtualRow.key}
                className="absolute inset-x-0 grid gap-4 pb-4"
                style={{
                  height: ROW_HEIGHT,
                  gridTemplateColumns: `repeat(${COLUMNS}, minmax(0, 1fr))`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {rowLinks.map((link, cardIndex) => {
                  const index = start + cardIndex;
                  const pinned = index < pinnedCount;
                  const selected = bulkEditing && selectedLinks.has(link.path);
                  return (
                    <div
                      key={link.path}
                      className={`relative flex flex-col overflow-hidden rounded-lg border border-border ${
                        selected ? 'bg-muted' : 'hover:bg-muted/50'
                      }`}
                    >
                      {/* The tag chips are buttons, so they sit OUTSIDE the anchor
                          as the card's bottom block (same no-button-in-anchor rule
                          as LinkRowMenu); the anchor's flex-1 pins them there. */}
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 flex-1 flex-col"
                        // In bulk-edit mode the card's click toggles selection
                        // instead of opening the link (middle/cmd-click still
                        // opens); shift-click extends a range over `links`.
                        onClick={
                          bulkEditing
                            ? (e) => {
                                e.preventDefault();
                                if (e.shiftKey) selectRange(link, links);
                                else toggleSelected(link);
                              }
                            : undefined
                        }
                      >
                        <LinkPreviewImage
                          link={link}
                          className="h-28 w-full shrink-0"
                          fallback="panel"
                        />
                        <div className="flex min-w-0 flex-col gap-2 p-3">
                          <div className="flex items-center gap-2">
                            {pinned && <PinnedBadge />}
                            <Favicon host={hostFromText(link.url)} className="size-4 shrink-0" />
                            <span className="truncate text-xs text-muted-foreground">
                              {hostFromText(link.url)}
                            </span>
                          </div>
                          <span className="line-clamp-2 text-sm font-medium">
                            {link.title || displayUrl(link.url)}
                          </span>
                        </div>
                      </a>
                      <LinkTagChips
                        link={link}
                        tagsById={tagsById}
                        maxLines={2}
                        className="px-3 pb-3"
                      />
                      {/* Floats over the banner now, so give it a readable pad. */}
                      <div className="absolute top-1 right-1 rounded-md bg-background/60">
                        {bulkEditing ? (
                          <LinkRowSelect link={link} links={links} />
                        ) : (
                          <LinkRowMenu
                            link={link}
                            pinned={pinned}
                            isFirst={index === 0}
                            isLast={index === pinnedCount - 1}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <ShowMore hasMore={hasMore} showMore={showMore} />
      </div>
    </div>
  );
}
