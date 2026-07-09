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
  faviconUrl,
  type LinkLayoutProps,
  LinkRowMenu,
  LinkRowSelect,
  PinnedBadge,
  RefreshPill,
  ShowMore,
  useReportDisplayedLinkPaths,
} from './shared';

const COLUMNS = 3;
const ROW_HEIGHT = 180;
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
  const { setScrolled, bulkEditing, selectedLinks, toggleSelected } = useLinksViewState();
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
                      className={`relative flex rounded-lg border border-border ${
                        selected ? 'bg-muted' : 'hover:bg-muted/50'
                      }`}
                    >
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 flex-1 flex-col gap-2 p-3"
                        // In bulk-edit mode the card's click toggles selection
                        // instead of opening the link (middle/cmd-click still opens).
                        onClick={
                          bulkEditing
                            ? (e) => {
                                e.preventDefault();
                                toggleSelected(link);
                              }
                            : undefined
                        }
                      >
                        <div className="flex items-center gap-2 pr-8">
                          {pinned && <PinnedBadge />}
                          <img
                            src={faviconUrl(link.url)}
                            alt=""
                            className="size-5 shrink-0 rounded"
                            loading="lazy"
                          />
                          <span className="truncate text-xs text-muted-foreground">
                            {hostFromText(link.url)}
                          </span>
                        </div>
                        <span className="line-clamp-3 text-sm font-medium">
                          {link.title || displayUrl(link.url)}
                        </span>
                      </a>
                      <div className="absolute top-1 right-1">
                        {bulkEditing ? (
                          <LinkRowSelect link={link} />
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
