'use client';

// Transient view state for the topbar + main pane that decides WHEN a background
// sync is allowed to repaint the list. The list is index-virtualized and sorted
// newest-first, so applying a sync mid-interaction shifts the rows under the user
// (the read edge, useLinks, holds results back instead — see its `hasPending` /
// refresh pill). "Mid-interaction" is six things, tracked here:
//
//   scrolled    — the active layout reports its scroll container left the top.
//                 Applying at the top is harmless (it's a newest-first feed), so we
//                 only guard once scrolled away. One layout is mounted at a time, so
//                 a single flag suffices; layouts reset it on mount/unmount.
//   openMenus   — a row's options menu is open; its trigger lives in a virtualized
//                 row, so a repaint can move or unmount it out from under the user.
//                 Counted (not a bool) so an open landing as another closes can't
//                 leave it stuck.
//   editing     — the link edit dialog is open. The dialog itself is hoisted to the
//                 page level (one instance, portaled) exactly so a repaint can't
//                 unmount it with a row, but repainting the list under a modal is
//                 still disorienting — same guard, same reason as openMenus. This is
//                 also WHERE the "which link is being edited" state lives: a menu
//                 item in a virtualized row requests it, the page-level dialog
//                 renders it (see LinkEditDialog).
//   destroying  — same hoisting for the Trash view's "Delete permanently"
//                 confirmation (see LinkDestroyConfirm). A LIST of links: the bulk
//                 toolbar's delete confirms the whole selection at once; the row
//                 menu passes a single-element list.
//   retagging   — same hoisting for the bulk-edit toolbar's "Edit tags" dialog
//                 (see BulkTagsDialog): the toolbar requests it with the
//                 selection, the page-level dialog renders it.
//   bulkEditing — bulk-edit mode is on (topbar toggles it, rows become selectable,
//                 the BulkEditToolbar shows). Selection is by row, so rows shifting
//                 mid-multi-select is exactly the disruption this flag exists for.
//                 The selection itself lives here too (`selectedLinks`, keyed by
//                 the stable `link.path` row key): the topbar enters the mode, the
//                 virtualized rows toggle membership, the toolbar acts on it.
//
// This is deliberately SEPARATE from page-provider (URL/layout state): it's
// ephemeral interaction state, never persisted, never in the URL. It does WATCH
// the page query (read-only) for one thing: navigating to another view exits
// bulk-edit mode, so a selection made in one view can never be acted on from
// another (Remove and Delete-permanently mean different things per view).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { LinkView } from '@stxapps/web-react';

import { useLinksPage } from './page-provider';

// An open edit-dialog request: the link's row snapshot (the dialog re-resolves
// freshness at save time — useLinkMutations.update re-reads before merging) and
// optionally which section to land focused ('tags' for the menu's "Edit tags").
export interface LinkEditRequest {
  link: LinkView;
  focus?: 'tags';
}

interface LinksViewStateValue {
  // True while a repaint would disrupt the user: scrolled past the top, a row
  // menu is open, a page-level dialog is up, or bulk-edit mode is on. useLinks
  // stages sync results while this holds.
  engaged: boolean;
  // The active layout's scroll position crossed (or returned to) the top.
  setScrolled: (scrolled: boolean) => void;
  // A row menu opened (true) or closed (false).
  setMenuOpen: (open: boolean) => void;
  // The link edit dialog: the open request (null = closed) and its controls.
  editing: LinkEditRequest | null;
  openEditor: (link: LinkView, focus?: 'tags') => void;
  closeEditor: () => void;
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
  // Bulk-edit mode: the topbar toggles it, rows toggle selection while it's on,
  // the BulkEditToolbar acts on the selection. Exiting clears the selection.
  bulkEditing: boolean;
  enterBulkEdit: () => void;
  exitBulkEdit: () => void;
  // Row snapshots keyed by `link.path` (the row key). Snapshots may go stale
  // under a held-back sync, which is fine: the mutations re-read the current
  // blob before acting (see useLinkMutations.update/destroy).
  selectedLinks: ReadonlyMap<string, LinkView>;
  toggleSelected: (link: LinkView) => void;
  // Shift-click range: select every row between the last-toggled anchor and
  // `link` (inclusive) within the currently displayed order `orderedLinks`,
  // adding them to the selection. Falls back to a plain toggle when there's no
  // usable anchor (first click, or the anchor scrolled out of the list). The
  // anchor stays put so repeated shift-clicks re-extend from the same origin.
  selectRange: (link: LinkView, orderedLinks: readonly LinkView[]) => void;
  // Replace the selection with the given rows / clear it without leaving
  // bulk-edit mode — the two sides of the toolbar's Select-all checkbox.
  selectAll: (links: LinkView[]) => void;
  clearSelected: () => void;
}

const LinksViewStateContext = createContext<LinksViewStateValue | null>(null);

export function LinksViewStateProvider({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [openMenus, setOpenMenus] = useState(0);
  const [editing, setEditing] = useState<LinkEditRequest | null>(null);
  const [destroying, setDestroying] = useState<LinkView[] | null>(null);
  const [retagging, setRetagging] = useState<LinkView[] | null>(null);
  const [bulkEditing, setBulkEditing] = useState(false);
  const [selectedLinks, setSelectedLinks] = useState<ReadonlyMap<string, LinkView>>(new Map());
  // The `link.path` a shift-click range extends FROM — the last row toggled on
  // its own. A ref (not state): it only feeds the next selectRange call, never
  // renders. Kept in sync by toggleSelected; reset whenever the selection is
  // replaced wholesale (selectAll / clearSelected / exitBulkEdit).
  const anchorPathRef = useRef<string | null>(null);

  const setMenuOpen = useCallback((open: boolean) => {
    setOpenMenus((n) => Math.max(0, n + (open ? 1 : -1)));
  }, []);

  const openEditor = useCallback((link: LinkView, focus?: 'tags') => {
    setEditing({ link, focus });
  }, []);
  const closeEditor = useCallback(() => setEditing(null), []);

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
    anchorPathRef.current = null;
  }, []);
  const toggleSelected = useCallback((link: LinkView) => {
    anchorPathRef.current = link.path;
    setSelectedLinks((prev) => {
      const next = new Map(prev);
      if (next.has(link.path)) next.delete(link.path);
      else next.set(link.path, link);
      return next;
    });
  }, []);
  const selectRange = useCallback(
    (link: LinkView, orderedLinks: readonly LinkView[]) => {
      const anchorPath = anchorPathRef.current;
      const targetIndex = orderedLinks.findIndex((l) => l.path === link.path);
      const anchorIndex =
        anchorPath === null ? -1 : orderedLinks.findIndex((l) => l.path === anchorPath);
      // No usable anchor (or either endpoint scrolled out of the current list):
      // fall back to a plain toggle, which also (re)sets the anchor.
      if (anchorIndex === -1 || targetIndex === -1) {
        toggleSelected(link);
        return;
      }
      const [lo, hi] =
        anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
      setSelectedLinks((prev) => {
        const next = new Map(prev);
        for (let i = lo; i <= hi; i++) next.set(orderedLinks[i].path, orderedLinks[i]);
        return next;
      });
    },
    [toggleSelected],
  );
  const selectAll = useCallback((links: LinkView[]) => {
    setSelectedLinks(new Map(links.map((link) => [link.path, link])));
    anchorPathRef.current = null;
  }, []);
  const clearSelected = useCallback(() => {
    setSelectedLinks(new Map());
    anchorPathRef.current = null;
  }, []);

  // Navigating to another view (sidebar click, back button, deep link) exits
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
      engaged:
        scrolled ||
        openMenus > 0 ||
        editing !== null ||
        destroying !== null ||
        retagging !== null ||
        bulkEditing,
      setScrolled,
      setMenuOpen,
      editing,
      openEditor,
      closeEditor,
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
      selectRange,
      selectAll,
      clearSelected,
    }),
    [
      scrolled,
      openMenus,
      setMenuOpen,
      editing,
      openEditor,
      closeEditor,
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
      selectRange,
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
