'use client';

// Reactive, paginated read of the link library for the main pane. `useLiveQuery`
// re-runs whenever the underlying `items` rows change — which is exactly when the
// sync engine reconciles a pull or the UI commits a local edit — so the list
// stays live with no manual invalidation. It also re-runs when `query` or `limit`
// change (the deps below), since those reshape the query.
//
// Pagination is pushed into the read (`readLinks`): the active view reads only
// its page through the `item*` indexes (db.ts), never the whole library, so this
// scales to a large library without loading and sorting it in memory. "Show more"
// grows `limit`, which re-runs the query for the larger page. `total` is
// `undefined` when the read can't cheaply count it (an active text search) — see
// LinksResult.

import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useLinksPage } from '../links-page-provider';

import { type LinkItem, readLinks } from '@/data/user-data';

const PAGE_SIZE = 50;

export interface UseLinksResult {
  links: LinkItem[];
  // Exact match count, or `undefined` when it isn't known: an active text search
  // (not cheaply countable — LinksResult) or the first query still in flight.
  // Distinct from `0`, which is a real empty result.
  total?: number;
  hasMore: boolean;
  showMore: () => void;
  // undefined while the first query is in flight (useLiveQuery's initial value).
  isLoading: boolean;
}

export function useLinks(): UseLinksResult {
  const { query } = useLinksPage();
  const [limit, setLimit] = useState(PAGE_SIZE);

  const page = useLiveQuery(() => readLinks(query, limit), [query, limit]);

  return {
    links: page?.links ?? [],
    total: page?.total,
    hasMore: page?.hasMore ?? false,
    showMore: () => setLimit((value) => value + PAGE_SIZE),
    isLoading: page === undefined,
  };
}
