'use client';

// Bits common to all three link layouts: the props contract, an empty state, a
// "show more" footer, and a couple of presentation helpers. Each layout owns its
// own scroll container + virtualizer (row geometry differs per layout), so this
// is deliberately just the shared chrome, not a base component.

import { ArrowDown, ArrowUp, MoreHorizontal, Pin, PinOff } from 'lucide-react';

import { Button } from '@stxapps/web-ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@stxapps/web-ui/components/ui/dropdown-menu';

import { usePinMutations } from '../../_hooks/use-pin-mutations';

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
  return (
    <DropdownMenu>
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

export function ShowMore({ hasMore, showMore }: { hasMore: boolean; showMore: () => void }) {
  if (!hasMore) return null;
  return (
    <div className="flex justify-center py-4">
      <Button variant="outline" size="sm" onClick={showMore}>
        Show more
      </Button>
    </div>
  );
}
