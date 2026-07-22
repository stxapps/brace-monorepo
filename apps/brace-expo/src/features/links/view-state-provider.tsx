// Transient view state for the links screen that decides WHEN a background
// sync is allowed to repaint the list — the expo port of brace-web's
// `(app)/links/_contexts/view-state-provider.tsx` (canonical doc: the list is
// virtualized and newest-first, so applying a sync mid-interaction shifts rows
// under the user; the read edge holds results back while `engaged`).
//
// Ported so far: `scrolled` (the FlashList reports its scroll position left
// the top; applying at the top is harmless — newest-first feed — so we only
// guard once scrolled away), plus the bulk-edit trio: `bulkEditing` (the mode
// + its `selectedLinks` snapshot map, keyed by the stable `link.path` row
// key), `destroying` (the hoisted permanent-delete confirmation —
// LinkDestroyConfirm), and `retagging` (the hoisted bulk "Edit tags" dialog —
// BulkTagsDialog). Web's remaining engagement signals (openMenus / editing)
// arrive with the features that own them: the row menu and the edit dialog are
// not on this screen yet. Web's `selectRange` (shift-click) has no analogue on
// touch and is deliberately not ported.
//
// Like web, navigating to another view exits bulk-edit mode (watched off the
// page query's identity) — a selection made in one view can never be acted on
// from another (Remove and Delete-permanently mean different things per view).
//
// Also home to the search bar's chrome state. On web the search box is
// persistent topbar chrome; on this narrow screen it's summoned by the
// topbar's search toggle, which makes it the same kind of transient chrome
// state as `bulkEditing` (whose bottom bar it is mutually exclusive with —
// the search bar row hides while the mode is on, see search-bar.tsx). An OPEN
// bar is not an engagement signal: the list only changes when a search commits
// (a navigation), so a background repaint under the bar disturbs nothing.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { LinkView } from '@stxapps/expo-react';

import { type Selection, useLinksPage } from './page-provider';

// What `preSearch` may hold: a selection the drawer/topbar can render WITHOUT
// the search bar — everything but the 'none' projection. Narrowing the type
// (not just the writers) is what guarantees restoring a snapshot can never
// itself resolve `selection` to 'none' and force the bar back open.
export type SimpleSelection = Exclude<Selection, { kind: 'none' }>;

interface LinksViewStateValue {
  // True while a repaint would disrupt the user: scrolled past the top, a
  // page-level dialog is up, or bulk-edit mode is on. useLinks stages sync
  // results while this holds.
  engaged: boolean;
  // The list's scroll position crossed (or returned to) the top.
  setScrolled: (scrolled: boolean) => void;
  // The user summoned the search bar row below the topbar (topbar's search
  // toggle). Explicit chrome INTENT, not the rendered visibility — the bar
  // renders when `searchOpen || selection.kind === 'none'`, computed at its
  // consumers (topbar + search-bar).
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  // Where the user was when the search bar was summoned — dismissing a
  // committed search returns here instead of home (topbar's toggle). Null when
  // the bar has never been opened, or was opened over a compound deep-link
  // view ('none' selection), which has no clean single-axis restore target.
  preSearch: SimpleSelection | null;
  setPreSearch: (selection: SimpleSelection | null) => void;
  // The permanent-delete confirmation: the links awaiting it (null = none; an
  // empty request is ignored, so a non-null value always has at least one).
  destroying: LinkView[] | null;
  requestDestroy: (links: LinkView[]) => void;
  closeDestroy: () => void;
  // The bulk "Edit tags" dialog: the links awaiting it (null = closed; an empty
  // request is ignored, so a non-null value always has at least one).
  retagging: LinkView[] | null;
  requestRetag: (links: LinkView[]) => void;
  closeRetag: () => void;
  // Bulk-edit mode: the ⋯ menu enters it, rows toggle selection while it's on,
  // the BulkEditBar acts on the selection. Exiting clears the selection.
  bulkEditing: boolean;
  enterBulkEdit: () => void;
  exitBulkEdit: () => void;
  // Row snapshots keyed by `link.path` (the row key). Snapshots may go stale
  // under a held-back sync, which is fine: the mutations re-read the current
  // blob before acting (see useLinkMutations.update/destroy).
  selectedLinks: ReadonlyMap<string, LinkView>;
  toggleSelected: (link: LinkView) => void;
  // Replace the selection with the given rows / clear it without leaving
  // bulk-edit mode — the two sides of the bar's Select-all checkbox.
  selectAll: (links: LinkView[]) => void;
  clearSelected: () => void;
}

const LinksViewStateContext = createContext<LinksViewStateValue | null>(null);

export function LinksViewStateProvider({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [preSearch, setPreSearch] = useState<SimpleSelection | null>(null);
  const [destroying, setDestroying] = useState<LinkView[] | null>(null);
  const [retagging, setRetagging] = useState<LinkView[] | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [selectedLinks, setSelectedLinks] = useState<ReadonlyMap<string, LinkView>>(new Map());

  const requestDestroy = useCallback((links: LinkView[]) => {
    if (links.length > 0) setDestroying(links);
  }, []);
  const closeDestroy = useCallback(() => setDestroying(null), []);

  const requestRetag = useCallback((links: LinkView[]) => {
    if (links.length > 0) setRetagging(links);
  }, []);
  const closeRetag = useCallback(() => setRetagging(null), []);

  const enterBulkEdit = useCallback(() => setBulkEditing(true), []);
  const exitBulkEdit = useCallback(() => {
    setBulkEditing(false);
    setSelectedLinks(new Map());
  }, []);
  const toggleSelected = useCallback((link: LinkView) => {
    setSelectedLinks((prev) => {
      const next = new Map(prev);
      if (next.has(link.path)) next.delete(link.path);
      else next.set(link.path, link);
      return next;
    });
  }, []);
  const selectAll = useCallback((links: LinkView[]) => {
    setSelectedLinks(new Map(links.map((link) => [link.path, link])));
  }, []);
  const clearSelected = useCallback(() => {
    setSelectedLinks(new Map());
  }, []);

  // Navigating to another view (drawer press, back gesture, deep link) exits
  // bulk-edit mode — see the header comment. Keyed on the query's identity, the
  // same stable reference useLinks depends on.
  const { query } = useLinksPage();
  const prevQueryRef = useRef(query);
  useEffect(() => {
    if (prevQueryRef.current === query) return;
    prevQueryRef.current = query;
    exitBulkEdit();
  }, [query, exitBulkEdit]);

  const value = useMemo<LinksViewStateValue>(
    () => ({
      engaged: scrolled || destroying !== null || retagging !== null || bulkEditing,
      setScrolled,
      searchOpen,
      setSearchOpen,
      preSearch,
      setPreSearch,
      destroying,
      requestDestroy,
      closeDestroy,
      retagging,
      requestRetag,
      closeRetag,
      bulkEditing,
      enterBulkEdit,
      exitBulkEdit,
      selectedLinks,
      toggleSelected,
      selectAll,
      clearSelected,
    }),
    [
      scrolled,
      searchOpen,
      preSearch,
      destroying,
      requestDestroy,
      closeDestroy,
      retagging,
      requestRetag,
      closeRetag,
      bulkEditing,
      enterBulkEdit,
      exitBulkEdit,
      selectedLinks,
      toggleSelected,
      selectAll,
      clearSelected,
    ],
  );

  return <LinksViewStateContext.Provider value={value}>{children}</LinksViewStateContext.Provider>;
}

export function useLinksViewState(): LinksViewStateValue {
  const ctx = useContext(LinksViewStateContext);
  if (!ctx) {
    throw new Error('useLinksViewState must be used within a LinksViewStateProvider');
  }
  return ctx;
}
