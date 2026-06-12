'use client';

// Grid-of-previews layout. Virtualized by ROW (each virtual item is a row of
// `COLUMNS` cards) — the simplest way to virtualize a uniform grid: divide the
// link list into chunks and lay each chunk out with a flex/grid row. Card height
// is fixed so the row estimate stays exact.

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { EmptyState, faviconUrl, hostname, type LinkLayoutProps,ShowMore } from './shared';

const COLUMNS = 3;
const ROW_HEIGHT = 180;

export function CardLayout({ links, hasMore, showMore, isLoading }: LinkLayoutProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(links.length / COLUMNS);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
  });

  if (links.length === 0) return <EmptyState isLoading={isLoading} />;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-4">
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
              {rowLinks.map((link) => (
                <a
                  key={link.path}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col gap-2 rounded-lg border border-border p-3 hover:bg-muted/50"
                >
                  <div className="flex items-center gap-2">                    <img
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
              ))}
            </div>
          );
        })}
      </div>
      <ShowMore hasMore={hasMore} showMore={showMore} />
    </div>
  );
}
