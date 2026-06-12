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
import { useRouter, useSearchParams } from 'next/navigation';

import { ALL_ID, DEFAULT_LIST_ID } from '@stxapps/shared';

// How the main pane lays out the link list. `list` is the dense default; `card`
// is a grid of previews; `table` is columnar with a header row. This is the
// layout only — the filter (which list/tag) is `selection`, a separate axis.
export type LayoutMode = 'list' | 'card' | 'table';

// What the main pane is filtered to. `all` is the unfiltered Show-All view;
// `list`/`tag` carry the selected entity's bare id (a system constant or a user
// entity id — the same id a link stores in `link.list` / `link.tags`).
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

interface LinksPageContextValue {
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  selection: Selection;
  setSelection: (selection: Selection) => void;
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
    () => ({ layoutMode, setLayoutMode, selection, setSelection }),
    [layoutMode, setLayoutMode, selection, setSelection],
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
