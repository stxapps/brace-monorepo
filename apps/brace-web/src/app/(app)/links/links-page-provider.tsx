'use client';

// Shared chrome state for the links page: the active `selection` (which the
// sidebar sets, the topbar names, and the main pane filters by) and the
// `layoutMode` (the list/card/table switch).
//
// The two live in DIFFERENT places on purpose:
//
//   selection → the URL (`?list=…` / `?tag=…`). It survives reload, the back
//     button works, and it's deep-linkable. The param value is always an OPAQUE
//     id — a system-list constant (`my-list`/`archive`/`trash`/`all`) or a user
//     entity's random token — NEVER the plaintext list/tag name, which stays
//     encrypted in the local store. That's what keeps the URL zero-knowledge.
//
//   layoutMode → localStorage. It's a private display preference, not something to
//     share or bookmark, so it has no business in the URL (a shared link
//     shouldn't drag the sender's layout along).
//
// The provider supplies its OWN Suspense boundary (see LinksPageProvider below):
// useSearchParams() opts the subtree out of static prerendering, which Next
// requires a Suspense boundary above. Owning it here — rather than at every call
// site — means consumers just render <LinksPageProvider> and the constraint
// travels with it (the self-wrapping AuthGuard/GuestGuard pattern).

import { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { type ReadonlyURLSearchParams, useRouter, useSearchParams } from 'next/navigation';

import { ALL_ID, DEFAULT_LIST_ID } from '@stxapps/shared';

import type { LinkQuery } from '@/data/user-data';

// How the main pane lays out the link list. `list` is the dense default; `card`
// is a grid of previews; `table` is columnar with a header row. This is the
// layout only — the filter (which list/tag) is `selection`, a separate axis.
export type LayoutMode = 'list' | 'card' | 'table';

// What the main pane is filtered to. `all` is the unfiltered Show-All view;
// `list`/`tag` carry the selected entity's bare id (a system constant or a user
// entity id — the same id a link stores in `link.listId` / `link.tagIds`).
export type Selection =
  | { kind: 'all' }
  | { kind: 'list'; id: string }
  | { kind: 'tag'; id: string };

// Shown when `/links` has no param: the default inbox, My List.
const DEFAULT_SELECTION: Selection = { kind: 'list', id: DEFAULT_LIST_ID };

const LAYOUT_MODE_KEY = 'brace:links:layout';
const LAYOUT_MODES: LayoutMode[] = ['list', 'card', 'table'];

// The canonical URL for a selection. The default (My List) is the bare `/links`,
// so the page's home carries no query noise; everything else is one opaque id.
// `tag`/user-list ids are random tokens, so encode them; the system ids are
// URL-safe literals but encoding is harmless and keeps the builder uniform.
function hrefForSelection(selection: Selection): string {
  if (selection.kind === 'all') return `/links?list=${ALL_ID}`;
  if (selection.kind === 'tag') return `/links?tag=${encodeURIComponent(selection.id)}`;
  if (selection.id === DEFAULT_LIST_ID) return '/links';
  return `/links?list=${encodeURIComponent(selection.id)}`;
}

// The URL → `LinkQuery` grammar (data layer owns `LinkQuery`; this maps the URL
// onto it). Each filterable field carries a relation in its param NAME:
//   list / list-any / list-none           (a link is in one list: no `all`)
//   tag  / tag-any  / tag-all  / tag-none
//   url  / url-all  / url-any  / url-none  (substring words)
//   title/ title-all/ title-any/ title-none
//   sort = created | updated               (ordering, default updated)
// The bare name is sugar for the common relation: `list`/`tag` → `any` (include),
// `url`/`title` → `all` (must contain every word). Clauses AND across fields.
// Values are REPEATED keys (`?tag=a&tag=b`), never `+` (decodes to space) or
// comma (breaks on ids containing one). Today's UI only ever emits the bare
// forms; the suffixed forms make hand-built advanced deep links work already.
const FILTER_KEYS = [
  'list', 'list-any', 'list-none',
  'tag', 'tag-any', 'tag-all', 'tag-none',
  'url', 'url-all', 'url-any', 'url-none',
  'title', 'title-all', 'title-any', 'title-none',
];

// Words are matched case-insensitively and trimmed; lowercase them here so the
// data layer can compare directly.
function words(raw: string[]): string[] {
  return raw.map((w) => w.trim().toLowerCase()).filter((w) => w.length > 0);
}

function parseLinkQuery(searchParams: ReadonlyURLSearchParams): LinkQuery {
  const query: LinkQuery = {
    lists: {
      // `all` is the show-everything pseudo-list, not a real filter — drop it.
      any: [...searchParams.getAll('list'), ...searchParams.getAll('list-any')].filter(
        (id) => id !== ALL_ID,
      ),
      none: searchParams.getAll('list-none'),
    },
    tags: {
      any: [...searchParams.getAll('tag'), ...searchParams.getAll('tag-any')],
      all: searchParams.getAll('tag-all'),
      none: searchParams.getAll('tag-none'),
    },
    url: {
      all: words([...searchParams.getAll('url'), ...searchParams.getAll('url-all')]),
      any: words(searchParams.getAll('url-any')),
      none: words(searchParams.getAll('url-none')),
    },
    title: {
      all: words([...searchParams.getAll('title'), ...searchParams.getAll('title-all')]),
      any: words(searchParams.getAll('title-any')),
      none: words(searchParams.getAll('title-none')),
    },
    // Ordering, not a filter: `?sort=created` (date added) vs the default
    // `updated` (date modified). Deliberately NOT in FILTER_KEYS, so `?sort=…`
    // alone still falls back to the default list below.
    sort: searchParams.get('sort') === 'created' ? 'createdAt' : 'updatedAt',
  };

  // No filter params at all → the default inbox (My List). `?list=all` IS a param
  // (the show-all view), so it doesn't trigger the default — it leaves the lists
  // clause empty after the ALL_ID drop above, i.e. no filter.
  if (!FILTER_KEYS.some((key) => searchParams.has(key))) {
    query.lists.any = [DEFAULT_LIST_ID];
  }
  return query;
}

interface LinksPageContextValue {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  // The single-axis sidebar/topbar view state (what's highlighted / named).
  selection: Selection;
  setSelection: (selection: Selection) => void;
  // The full filter the main pane reads through (`readLinks`). Derived from the
  // same URL as `selection`, but expresses the whole grammar (and/or/none across
  // lists, tags, and url/title words), not just the single selected axis.
  query: LinkQuery;
}

const LinksPageContext = createContext<LinksPageContextValue | null>(null);

function InnerLinksPageProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // The URL is the source of truth; selection is derived, not stored. `tag` wins
  // over `list` if both are somehow present (they're mutually exclusive in
  // practice), and an absent `list` falls back to the default inbox.
  const selection = useMemo<Selection>(() => {
    const tag = searchParams.get('tag');
    if (tag) return { kind: 'tag', id: tag };

    const list = searchParams.get('list');
    if (list === ALL_ID) return { kind: 'all' };
    if (list) return { kind: 'list', id: list };
    return DEFAULT_SELECTION;
  }, [searchParams]);

  // The main pane's full filter — same URL, the whole grammar. Memoized on the
  // params so its identity is stable across renders (it's a useLiveQuery dep in
  // useLinks); a new object only when the URL actually changes.
  const query = useMemo<LinkQuery>(() => parseLinkQuery(searchParams), [searchParams]);

  // push (not replace) so the back button steps through the lists you visited —
  // the deep-link/history behavior the URL approach is for.
  const setSelection = useCallback(
    (next: Selection) => router.push(hrefForSelection(next)),
    [router],
  );

  // layoutMode: default-first so SSR and the first client render agree (no
  // hydration mismatch); the stored preference is read after mount and written
  // back on every change.
  const [layoutMode, setLayoutModeState] = useState<LayoutMode>('list');

  useEffect(() => {
    const stored = window.localStorage.getItem(LAYOUT_MODE_KEY);
    if (stored && (LAYOUT_MODES as string[]).includes(stored)) {
      setLayoutModeState(stored as LayoutMode);
    }
  }, []);

  const setLayoutMode = useCallback((mode: LayoutMode) => {
    setLayoutModeState(mode);
    window.localStorage.setItem(LAYOUT_MODE_KEY, mode);
  }, []);

  const value = useMemo(
    () => ({ layoutMode, setLayoutMode, selection, setSelection, query }),
    [layoutMode, setLayoutMode, selection, setSelection, query],
  );

  return <LinksPageContext.Provider value={value}>{children}</LinksPageContext.Provider>;
}

// The boundary the header comment describes: useSearchParams() (in the inner
// component) can't be statically prerendered, so it must sit under Suspense. The
// null fallback renders nothing until the params resolve — matching the gates
// above it in the (app) layout, so there's no flash.
export function LinksPageProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <InnerLinksPageProvider>{children}</InnerLinksPageProvider>
    </Suspense>
  );
}

export function useLinksPage(): LinksPageContextValue {
  const value = useContext(LinksPageContext);
  if (!value) {
    throw new Error('useLinksPage must be used within a LinksPageProvider');
  }
  return value;
}
