'use client';

// Dense one-row-per-link layout (the default). Window-virtualized with
// @tanstack/react-virtual: only the rows in view are mounted, so a large library
// scrolls cheaply. `ShowMore` lives outside the virtual measurement, below the
// rows, growing the page on click.

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import {
  EmptyState,
  faviconUrl,
  hostname,
  type LinkLayoutProps,
  LinkRowMenu,
  PinnedBadge,
  ShowMore,
} from './shared';

const ROW_HEIGHT = 64;

export function ListLayout({ links, pinnedCount, hasMore, showMore, isLoading }: LinkLayoutProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: links.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  if (links.length === 0) return <EmptyState isLoading={isLoading} />;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const link = links[row.index];
          const pinned = row.index < pinnedCount;
          return (
            <div
              key={link.path}
              className="absolute inset-x-0 flex items-center gap-1 border-b border-border pr-2 hover:bg-muted/50"
              style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
            >
              <a
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-full min-w-0 flex-1 items-center gap-3 px-4"
              >
                <img
                  src={faviconUrl(link.url)}
                  alt=""
                  className="size-6 shrink-0 rounded"
                  loading="lazy"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {pinned && <PinnedBadge />}
                    <span className="truncate text-sm font-medium">
                      {link.title || hostname(link.url)}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {hostname(link.url)}
                  </span>
                </span>
              </a>
              <LinkRowMenu
                link={link}
                pinned={pinned}
                isFirst={row.index === 0}
                isLast={row.index === pinnedCount - 1}
              />
            </div>
          );
        })}
      </div>
      <ShowMore hasMore={hasMore} showMore={showMore} />
    </div>
  );
}
