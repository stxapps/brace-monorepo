'use client';

// Bits common to all three link layouts: the props contract, an empty state, a
// "show more" footer, and a couple of presentation helpers. Each layout owns its
// own scroll container + virtualizer (row geometry differs per layout), so this
// is deliberately just the shared chrome, not a base component.

import { Button } from '@stxapps/web-ui/components/ui/button';

import type { LinkItem } from '../data';

export interface LinkLayoutProps {
  links: LinkItem[];
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
