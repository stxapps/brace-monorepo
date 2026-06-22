'use client';

// Bits common to all three link layouts: the props contract, an empty state, a
// "show more" footer, and a couple of presentation helpers. Each layout owns its
// own scroll container + virtualizer (row geometry differs per layout), so this
// is deliberately just the shared chrome, not a base component.

import { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, MoreHorizontal, Pin, PinOff, RefreshCw } from 'lucide-react';

import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@stxapps/web-ui/components/ui/dropdown-menu';

import { usePinMutations } from '../../_hooks/use-pin-mutations';
import { useLinksViewState } from '../_contexts/view-state-provider';

import type { LinkItem } from '@/data/queries';

export interface LinkLayoutProps {
  links: LinkItem[];
  // Leading `pinnedCount` entries of `links` are pinned, in pin-rank order (top
  // first). A row at index `i` is pinned iff `i < pinnedCount`; it's the topmost
  // pin at `i === 0` and the bottom pin at `i === pinnedCount - 1`.
  pinnedCount: number;
  hasMore: boolean;
  showMore: () => void;
  isLoading: boolean;
  // A background sync has newer results being held back; render the RefreshPill.
  hasPending: boolean;
  // Swap the held results in (the pill's click also scrolls the layout to top).
  applyPending: () => void;
}

// Best-effort hostname for the secondary line / favicon. URLs come from user
// input and may be malformed, so fall back to the raw string.
export function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Google's favicon service — no key, cached at the edge. Swap for a synced
// `files/` screenshot later if previews move local.
export function faviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostname(url))}`;
}

export function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      {isLoading ? 'Loading links…' : 'No links here yet.'}
    </div>
  );
}

// The per-row options menu. The pin actions live here so every layout renders one
// `<LinkRowMenu>` and the pin logic stays in one place. `pinned` swaps the menu
// between "Pin to top" and the pinned set (move up/down + unpin); `isFirst`/
// `isLast` disable the move that would fall off the pinned section's ends.
//
// The menu is a sibling of the row's link, never nested inside the `<a>` — a
// button inside an anchor is invalid and would also fire the navigation. The
// wrapper stops click/keydown from bubbling so opening the menu never triggers the
// row. Dropdown content is portaled, so item clicks are outside the row entirely.
export function LinkRowMenu({
  link,
  pinned,
  isFirst,
  isLast,
}: {
  link: LinkItem;
  pinned: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { pin, unpin, moveUp, moveDown } = usePinMutations();
  // Report open/close so a background sync won't repaint the row (moving or
  // unmounting this trigger) while the menu is open — see view-state-provider. Track
  // our own open state so an unmount-while-open (e.g. a layout switch) releases
  // the count instead of leaking it and pinning `engaged` true forever.
  const { setMenuOpen } = useLinksViewState();
  const openRef = useRef(false);
  useEffect(
    () => () => {
      if (openRef.current) setMenuOpen(false);
    },
    [setMenuOpen],
  );
  const handleOpenChange = (open: boolean) => {
    openRef.current = open;
    setMenuOpen(open);
  };
  return (
    <DropdownMenu onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          aria-label="Link options"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {pinned ? (
          <>
            <DropdownMenuItem disabled={isFirst} onSelect={() => void moveUp(link)}>
              <ArrowUp className="size-4" />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onSelect={() => void moveDown(link)}>
              <ArrowDown className="size-4" />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void unpin(link)}>
              <PinOff className="size-4" />
              Unpin
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={() => void pin(link)}>
            <Pin className="size-4" />
            Pin to top
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// A small pin glyph marking a pinned row at a glance.
export function PinnedBadge() {
  return <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />;
}

interface ShowMoreProps {
  hasMore: boolean;
  showMore: () => void;
}

export function ShowMore({ hasMore, showMore }: ShowMoreProps) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-4">
      <Button variant="outline" size="sm" onClick={showMore}>
        Show more
      </Button>
    </div>
  );
}

// The "new updates" affordance: a floating pill shown when a background sync has
// results held back (useLinks `hasPending`). It must be placed inside a
// `relative` wrapper that does NOT scroll (a sibling of the scroll container), so
// it stays pinned to the top of the pane instead of riding the scrolled content.
// Clicking applies the held results AND scrolls the layout to top, so the
// reorder lands where the user can see it rather than shifting them mid-list.
interface RefreshPillProps {
  show: boolean;
  onClick: () => void;
}

export function RefreshPill({ show, onClick }: RefreshPillProps) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <Button size="sm" onClick={onClick} className="pointer-events-auto rounded-full shadow-md">
        <RefreshCw className="size-4" />
        New updates
      </Button>
    </div>
  );
}
