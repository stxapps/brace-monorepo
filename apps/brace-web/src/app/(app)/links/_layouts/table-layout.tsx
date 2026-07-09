'use client';

// Columnar layout with a sticky header. Same row-virtualization as the list layout;
// the header sits outside the scrolled/measured area so it stays pinned. Columns
// are a CSS grid template shared by the header and every row so they align.

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

const ROW_HEIGHT = 44;
const COLUMNS = 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)_120px_40px]';
const SCROLL_TOP_THRESHOLD = 8;

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

export function TableLayout({
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
    overscan: 12,
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
    <div className="flex h-full flex-col">
      <div
        className={`grid ${COLUMNS} gap-3 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground`}
      >
        <span>Title</span>
        <span>Site</span>
        <span>Updated</span>
        <span className="sr-only">Options</span>
      </div>

      <div className="relative flex-1">
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
                  className={`absolute inset-x-0 grid ${COLUMNS} items-center gap-3 border-b border-border pr-2 pl-4 text-sm ${
                    selected ? 'bg-muted' : 'hover:bg-muted/50'
                  }`}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-w-0 items-center gap-2"
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
                    {pinned && <PinnedBadge />}
                    <img
                      src={faviconUrl(link.url)}
                      alt=""
                      className="size-4 shrink-0 rounded"
                      loading="lazy"
                    />
                    <span className="truncate">{link.title || displayUrl(link.url)}</span>
                  </a>
                  <span className="truncate text-muted-foreground">{hostFromText(link.url)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(link.updatedAt)}
                  </span>
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
    </div>
  );
}
