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

import {
  type LinkItem,
  type LinkQuery,
  type LinksResult,
  readLinks,
  useLocks,
  useSync,
} from '@stxapps/web-react';

import { useLinksPage } from '../_contexts/page-provider';
import { useLinksViewState } from '../_contexts/view-state-provider';

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

// Fold the currently-locked lists (lock-provider's coverage set — descendants
// included) into the query, so EVERY read path — Show All, tag views, text
// search, the pinned overlay, hand-built deep links — excludes their links
// through the one grammar primitive that already does exclusion, `lists.none`.
// This is the lock's enforcement edge; the main pane's lock pane is just chrome.
//
// The merge is shaped to keep the single-list index fast path (readRest bails to
// the filtered walk whenever `lists.none` is non-empty, losing the exact count):
//   - no locks → the SAME query reference (identity matters: it keys the live
//     query and the page-identity checks below);
//   - a positive list filter already excludes everything outside it, so locked
//     ids are REMOVED from `any` instead of added to `none` — an unlocked
//     single-list view stays on the fast path even while other lists are locked;
//   - if that empties `any` (every requested list is locked), the query must
//     match NOTHING — not fall through to "no list filter" — so the locked ids
//     stay in `any` AND go into `none`, which columnMatches resolves to zero;
//   - only the no-positive-filter views (Show All, tags, search) pay the `none`
//     clause.
function excludeLockedLists(query: LinkQuery, lockedListIds: ReadonlySet<string>): LinkQuery {
  if (lockedListIds.size === 0) return query;

  if (query.lists.any.length > 0) {
    const any = query.lists.any.filter((id) => !lockedListIds.has(id));
    if (any.length === query.lists.any.length) return query;
    if (any.length > 0) return { ...query, lists: { ...query.lists, any } };
    return {
      ...query,
      lists: { any: query.lists.any, none: [...query.lists.none, ...query.lists.any] },
    };
  }

  return {
    ...query,
    lists: { ...query.lists, none: [...query.lists.none, ...lockedListIds] },
  };
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
  const { query: urlQuery } = useLinksPage();
  const { lockedListIds } = useLocks();
  const { localWriteNonce } = useSync();
  const { engaged } = useLinksViewState();
  const [limit, setLimit] = useState(PAGE_SIZE);

  // The query the reads actually run — the URL query with locked lists folded in
  // (see excludeLockedLists). Memoized so its identity is stable like the URL
  // query's: it changes only when the URL or the locked set changes (an unlock
  // reads as a page change below and repaints immediately — the user's own
  // action). `lockedListIds` is identity-stable from lock-provider's memo.
  const query = useMemo(
    () => excludeLockedLists(urlQuery, lockedListIds),
    [urlQuery, lockedListIds],
  );

  // Reset pagination when the view changes: a new query is a fresh page and should
  // start at PAGE_SIZE, not inherit a grown "show more" limit from the previous
  // view. We adjust state DURING render (React's recommended pattern for deriving
  // state from a changed input) so `limit` is corrected before `useLiveQuery` below
  // reads it — an effect would instead let the query run once with the stale larger
  // limit, then re-run. Relies on the same stable `query` reference the deps do.
  const [queryForLimit, setQueryForLimit] = useState(query);
  if (query !== queryForLimit) {
    setQueryForLimit(query);
    setLimit(PAGE_SIZE);
  }

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
  // the new page replaces the snapshot rather than staging behind it. We read page
  // identity off the result itself — `readLinks` echoes the `query`/`limit` it ran
  // for — rather than diffing against a prev-render ref. This matters because on the
  // render right after a query/limit change, useLiveQuery still returns the PREVIOUS
  // result, which echoes the old page: `liveReflectsCurrentPage` is false until the fresh
  // page lands, so we neither promote the stale value as the new page nor retire the
  // signal early. (`live.query === query` is a reference check — the result stores
  // the exact object the querier was given, and page-provider keeps that reference
  // stable, the same contract the `[query, limit]` deps above already rely on.)
  useEffect(() => {
    if (live === undefined) return;
    const liveReflectsCurrentPage = live.query === query && live.limit === limit;
    const pageChanged =
      displayed === undefined || displayed.query !== live.query || displayed.limit !== live.limit;

    const promoteNow =
      displayed === undefined || // first paint
      (liveReflectsCurrentPage && pageChanged) || // navigation / show more — once the new page arrives
      Date.now() < graceUntilRef.current || // this device just edited
      !engaged; // idle: nothing to disturb

    if (promoteNow) setDisplayed(live);
    // else: hold — `displayed` stays put and `hasPending` lights the pill.
  }, [live, query, limit, engaged, displayed]);

  const liveSig = useMemo(() => (live ? signatureOf(live) : undefined), [live]);
  const displayedSig = useMemo(() => (displayed ? signatureOf(displayed) : undefined), [displayed]);
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
