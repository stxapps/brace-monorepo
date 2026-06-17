'use client';

// Grid-of-previews layout. Virtualized by ROW (each virtual item is a row of
// `COLUMNS` cards) — the simplest way to virtualize a uniform grid: divide the
// link list into chunks and lay each chunk out with a flex/grid row. Card height
// is fixed so the row estimate stays exact.

import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { useLinksViewState } from '../_contexts/view-state-provider';
import {
  EmptyState,
  faviconUrl,
  hostname,
  type LinkLayoutProps,
  LinkRowMenu,
  PinnedBadge,
  RefreshPill,
  ShowMore,
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
  const { setScrolled } = useLinksViewState();
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
        {virtualizer.getVirtualItems().map((virtualRow) => {
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
                return (
                  <div
                    key={link.path}
                    className="relative flex rounded-lg border border-border hover:bg-muted/50"
                  >
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 flex-1 flex-col gap-2 p-3"
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
                          {hostname(link.url)}
                        </span>
                      </div>
                      <span className="line-clamp-3 text-sm font-medium">
                        {link.title || hostname(link.url)}
                      </span>
                    </a>
                    <div className="absolute right-1 top-1">
                      <LinkRowMenu
                        link={link}
                        pinned={pinned}
                        isFirst={index === 0}
                        isLast={index === pinnedCount - 1}
                      />
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
