'use client';

// Reactive, paginated read of the link library for the main pane. `useLiveQuery`
// re-runs whenever the underlying `items` rows change — which is exactly when the
// sync engine reconciles a pull or the UI commits a local edit — so the read
// stays live with no manual invalidation. It also re-runs when `query` or `limit`
// change (the deps below), since those reshape the query.
//
// Pagination is pushed into the read (`readLinks`): the active view reads only
// its page through the `item*` indexes (db.ts), never the whole library, so this
// scales to a large library without loading and sorting it in memory. "Show more"
// grows `limit`, which re-runs the query for the larger page. `total` is
// `undefined` when the read can't cheaply count it (an active text search) — see
// LinksResult.
//
// Staged repaint. The list is index-virtualized and sorted newest-first, so
// blindly rendering every live result would shift the rows under a user who's
// scrolled down or has a row menu open (a touched link floats to the top; the
// menu's row moves or unmounts). So `live` keeps flowing but we render a held
// `displayed` snapshot, promoting it only when a repaint won't disrupt:
//   - first paint, and any query/limit change (navigation / "show more") — these
//     are the user's own action, never staged.
//   - just after a local edit on this device (localWriteNonce grace window) — the
//     optimistic write AND the sync cycle it kicks both land here, and they're the
//     user's change, so they apply at once.
//   - while idle (not engaged — see view-state-provider).
// Otherwise we stage: `displayed` stays put and `hasPending` lights the refresh
// pill, which calls `applyPending` to swap the latest results in on demand.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useLinksPage } from '../_contexts/page-provider';
import { useLinksViewState } from '../_contexts/view-state-provider';

import { useSync } from '@/contexts/sync-provider';
import { type LinkItem, type LinksResult, readLinks } from '@/data/queries';

const PAGE_SIZE = 50;

// How long after a local edit incoming results still apply eagerly. Covers both
// re-runs the edit triggers (the optimistic write, then the sync cycle it kicks)
// without depending on their exact ordering or timing.
const LOCAL_WRITE_GRACE_MS = 1500;

export interface UseLinksResult {
  links: LinkItem[];
  // How many leading entries of `links` are pinned (LinksResult). The layouts use
  // it to mark pinned rows and enable their move-up/down menu items.
  pinnedCount: number;
  // Exact match count, or `undefined` when it isn't known: an active text search
  // (not cheaply countable — LinksResult) or the first query still in flight.
  // Distinct from `0`, which is a real empty result.
  total?: number;
  hasMore: boolean;
  showMore: () => void;
  // undefined while the first query is in flight (useLiveQuery's initial value).
  isLoading: boolean;
  // True when a background sync produced results that differ from what's rendered
  // and they're being held back (the user is scrolled down / a menu is open). The
  // layouts surface a refresh pill; `applyPending` swaps the held results in.
  hasPending: boolean;
  applyPending: () => void;
}

// A cheap content fingerprint: equal iff the rendered page would look the same.
// Lets us tell a real update from a re-run that returns identical content — a
// write to an unrelated record (or another list) still re-fires the live query,
// and we don't want that to light the pill.
function signatureOf(result: LinksResult): string {
  const rows = result.links.map((link) => `${link.path}:${link.updatedAt}`).join('|');
  return `${rows}#${result.pinnedCount}/${result.total ?? '?'}/${result.hasMore}`;
}

export function useLinks(): UseLinksResult {
  const { query } = useLinksPage();
  const { localWriteNonce } = useSync();
  const { engaged } = useLinksViewState();
  const [limit, setLimit] = useState(PAGE_SIZE);

  // The always-current result. Kept flowing; we choose WHEN to show it.
  const live = useLiveQuery(() => readLinks(query, limit), [query, limit]);
  const liveRef = useRef(live);
  liveRef.current = live;

  // What's actually rendered — a snapshot promoted from `live`.
  const [displayed, setDisplayed] = useState<LinksResult>();

  // Local-edit grace: a bump moves the window forward and promotes immediately so
  // the optimistic write shows at once; the sync cycle it kicks lands within the
  // window and promotes too (see LOCAL_WRITE_GRACE_MS).
  const graceUntilRef = useRef(0);
  useEffect(() => {
    if (localWriteNonce === 0) return; // initial mount, not an edit
    graceUntilRef.current = Date.now() + LOCAL_WRITE_GRACE_MS;
    if (liveRef.current !== undefined) setDisplayed(liveRef.current);
  }, [localWriteNonce]);

  // A query/limit change is the user's own action (navigation or "show more"), so
  // the next result replaces the snapshot rather than staging behind it.
  const prevQueryRef = useRef(query);
  const prevLimitRef = useRef(limit);

  useEffect(() => {
    if (live === undefined) return;
    const pageChanged = prevQueryRef.current !== query || prevLimitRef.current !== limit;
    prevQueryRef.current = query;
    prevLimitRef.current = limit;

    const promoteNow =
      displayed === undefined || // first paint
      pageChanged || // navigation / show more
      Date.now() < graceUntilRef.current || // this device just edited
      !engaged; // idle: nothing to disturb

    if (promoteNow) setDisplayed(live);
    // else: hold — `displayed` stays put and `hasPending` lights the pill.
  }, [live, query, limit, engaged, displayed]);

  const liveSig = useMemo(() => (live ? signatureOf(live) : undefined), [live]);
  const displayedSig = useMemo(
    () => (displayed ? signatureOf(displayed) : undefined),
    [displayed],
  );
  const hasPending =
    liveSig !== undefined && displayedSig !== undefined && liveSig !== displayedSig;

  return {
    links: displayed?.links ?? [],
    pinnedCount: displayed?.pinnedCount ?? 0,
    total: displayed?.total,
    hasMore: displayed?.hasMore ?? false,
    showMore: () => setLimit((value) => value + PAGE_SIZE),
    isLoading: displayed === undefined,
    hasPending,
    applyPending: () => {
      if (liveRef.current !== undefined) setDisplayed(liveRef.current);
    },
  };
}
