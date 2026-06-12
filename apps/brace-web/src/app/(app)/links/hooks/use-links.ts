'use client';

// Reactive, paginated read of the link library for the main pane. `useLiveQuery`
// re-runs whenever the underlying `items` rows change — which is exactly when the
// sync engine reconciles a pull or the UI commits a local edit — so the list
// stays live with no manual invalidation.
//
// Pagination here is a render-cap, not a Dexie cursor: the whole `meta/` library
// is small by design (db.ts — list-view fields only, browsable offline) so we
// read it all, sort once, and slice to `limit`. "Show more" just grows `limit`.
// Swap to a keyed `.limit()` range scan only if a library ever outgrows memory.

import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { type LinkItem,readLinks } from '../data';
import { useLinksPage } from '../links-page-provider';

const PAGE_SIZE = 50;

function matchesSelection(
  link: LinkItem,
  selection: ReturnType<typeof useLinksPage>['selection'],
): boolean {
  if (selection.kind === 'all') return true;
  // Selection and link both key by the bare entity id (a system-list constant or
  // the `{id}` of `lists/{id}.enc` / `tags/{id}.enc`), so this is a direct match.
  // A dangling reference (entity deleted on another device — normal per
  // entities.ts) simply doesn't match.
  if (selection.kind === 'list') return link.list === selection.id;
  return link.tags.includes(selection.id);
}

export interface UseLinksResult {
  links: LinkItem[];
  total: number;
  hasMore: boolean;
  showMore: () => void;
  // undefined while the first query is in flight (useLiveQuery's initial value).
  isLoading: boolean;
}

export function useLinks(): UseLinksResult {
  const { selection } = useLinksPage();
  const [limit, setLimit] = useState(PAGE_SIZE);

  const all = useLiveQuery(() => readLinks(), []);

  const filtered = useMemo(() => {
    if (!all) return undefined;
    return all
      .filter((link) => matchesSelection(link, selection))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [all, selection]);

  const links = useMemo(() => filtered?.slice(0, limit) ?? [], [filtered, limit]);

  return {
    links,
    total: filtered?.length ?? 0,
    hasMore: (filtered?.length ?? 0) > limit,
    showMore: () => setLimit((value) => value + PAGE_SIZE),
    isLoading: all === undefined,
  };
}
