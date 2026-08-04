'use client';

// The layout's non-row chrome: the empty state, the "show more" footer, and the
// floating "new updates" refresh pill.

import { RefreshCw } from 'lucide-react';

import { Button } from '@stxapps/web-ui/components/ui/button';

export function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      {isLoading ? 'Loading links…' : 'No links here yet.'}
    </div>
  );
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
