// Pure query-grammar transforms — no Dexie, no decode, so they're unit-testable
// in isolation (importing queries.ts pulls in the whole read engine). Kept in the
// data layer beside the `LinkQuery` grammar and re-exported from queries.ts, which
// stays the read-layer facade app consumers read through.

import type { LinkQuery } from './queries';

// Rewrite a query to EXCLUDE a set of list ids, preserving the cheapest driver
// `readRest` (queries.ts) can pick. Pure grammar in, grammar out — the caller
// decides WHICH ids to suppress and why (e.g. lock coverage folds its locked set
// through here; see use-links). Shaped to keep the single-list index fast path
// (`readRest` bails to the filtered walk whenever `lists.none` is non-empty,
// losing the exact count):
//   - nothing to exclude → the SAME query reference (identity matters: callers
//     key their live query and page-identity checks off it — see use-links);
//   - a positive list filter already excludes everything outside it, so excluded
//     ids are REMOVED from `any` instead of added to `none` — a single-list view
//     stays on the fast path even while other lists are excluded;
//   - if that empties `any` (every requested list is excluded), the query must
//     match NOTHING — not fall through to "no list filter" — so the ids stay in
//     `any` AND go into `none`, which `columnMatches` resolves to zero;
//   - only the no-positive-filter views (Show All, tags, search) pay the `none`
//     clause.
export function excludeLists(query: LinkQuery, listIds: ReadonlySet<string>): LinkQuery {
  if (listIds.size === 0) return query;

  if (query.lists.any.length > 0) {
    const any = query.lists.any.filter((id) => !listIds.has(id));
    if (any.length === query.lists.any.length) return query;
    if (any.length > 0) return { ...query, lists: { ...query.lists, any } };
    return {
      ...query,
      lists: { any: query.lists.any, none: [...query.lists.none, ...query.lists.any] },
    };
  }

  return {
    ...query,
    lists: { ...query.lists, none: [...query.lists.none, ...listIds] },
  };
}
