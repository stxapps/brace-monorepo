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
  faviconUrl,
  type LinkLayoutProps,
  LinkRowMenu,
  LinkRowSelect,
  PinnedBadge,
  RefreshPill,
  ShowMore,
  useReportDisplayedLinkPaths,
} from './shared';

const ROW_HEIGHT = 64;
// Past this many pixels we treat the pane as "scrolled away from the top", so a
// background sync is staged behind the refresh pill (see view-state-provider).
const SCROLL_TOP_THRESHOLD = 8;

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
  const { setScrolled, bulkEditing, selectedLinks, toggleSelected } = useLinksViewState();

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

  if (links.length === 0) return <EmptyState isLoading={isLoading} />;

  return (
    <div className="relative h-full">
      <RefreshPill show={hasPending} onClick={applyAndScrollTop} />
      <div
        ref={scrollRef}
        className="h-full overflow-y-auto"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > SCROLL_TOP_THRESHOLD)}
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {rows.map((row) => {
            const link = links[row.index];
            const pinned = row.index < pinnedCount;
            const selected = bulkEditing && selectedLinks.has(link.path);
            return (
              <div
                key={link.path}
                className={`absolute inset-x-0 flex items-center gap-1 border-b border-border pr-2 ${
                  selected ? 'bg-muted' : 'hover:bg-muted/50'
                }`}
                style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
              >
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-full min-w-0 flex-1 items-center gap-3 px-4"
                  // In bulk-edit mode the row's click toggles selection instead
                  // of opening the link (middle/cmd-click still opens).
                  onClick={
                    bulkEditing
                      ? (e) => {
                          e.preventDefault();
                          toggleSelected(link);
                        }
                      : undefined
                  }
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
                        {link.title || displayUrl(link.url)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {hostFromText(link.url)}
                    </span>
                  </span>
                </a>
                {bulkEditing ? (
                  <LinkRowSelect link={link} />
                ) : (
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
