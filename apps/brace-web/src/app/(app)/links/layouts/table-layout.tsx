'use client';

// Columnar layout with a sticky header. Same row-virtualization as the list layout;
// the header sits outside the scrolled/measured area so it stays pinned. Columns
// are a CSS grid template shared by the header and every row so they align.

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import { EmptyState, faviconUrl, hostname, type LinkLayoutProps,ShowMore } from './shared';

const ROW_HEIGHT = 44;
const COLUMNS = 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_120px]';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

export function TableLayout({ links, hasMore, showMore, isLoading }: LinkLayoutProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: links.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  if (links.length === 0) return <EmptyState isLoading={isLoading} />;

  return (
    <div className="flex h-full flex-col">
      <div
        className={`grid ${COLUMNS} gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground`}
      >
        <span>Title</span>
        <span>Site</span>
        <span>Updated</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const link = links[row.index];
            return (
              <a
                key={link.path}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className={`absolute inset-x-0 grid ${COLUMNS} items-center gap-3 border-b border-border px-4 text-sm hover:bg-muted/50`}
                style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
              >
                <span className="flex min-w-0 items-center gap-2">                  <img
                    src={faviconUrl(link.url)}
                    alt=""
                    className="size-4 shrink-0 rounded"
                    loading="lazy"
                  />
                  <span className="truncate">{link.title || hostname(link.url)}</span>
                </span>
                <span className="truncate text-muted-foreground">{hostname(link.url)}</span>
                <span className="text-xs text-muted-foreground">{formatDate(link.updatedAt)}</span>
              </a>
            );
          })}
        </div>
        <ShowMore hasMore={hasMore} showMore={showMore} />
      </div>
    </div>
  );
}
