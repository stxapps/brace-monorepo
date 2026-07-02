'use client';

// Transient view state for the main pane that decides WHEN a background sync is
// allowed to repaint the list. The list is index-virtualized and sorted
// newest-first, so applying a sync mid-interaction shifts the rows under the user
// (the read edge, useLinks, holds results back instead — see its `hasPending` /
// refresh pill). "Mid-interaction" is four things, tracked here:
//
//   scrolled   — the active layout reports its scroll container left the top.
//                Applying at the top is harmless (it's a newest-first feed), so we
//                only guard once scrolled away. One layout is mounted at a time, so
//                a single flag suffices; layouts reset it on mount/unmount.
//   openMenus  — a row's options menu is open; its trigger lives in a virtualized
//                row, so a repaint can move or unmount it out from under the user.
//                Counted (not a bool) so an open landing as another closes can't
//                leave it stuck.
//   editing    — the link edit dialog is open. The dialog itself is hoisted to the
//                page level (one instance, portaled) exactly so a repaint can't
//                unmount it with a row, but repainting the list under a modal is
//                still disorienting — same guard, same reason as openMenus. This is
//                also WHERE the "which link is being edited" state lives: a menu
//                item in a virtualized row requests it, the page-level dialog
//                renders it (see LinkEditDialog).
//   destroying — same hoisting for the Trash view's "Delete permanently"
//                confirmation (see LinkDestroyConfirm).
//
// This is deliberately SEPARATE from page-provider (URL/layout state): it's
// ephemeral interaction state, never persisted, never in the URL.

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { LinkView } from '@stxapps/web-react';

// An open edit-dialog request: the link's row snapshot (the dialog re-resolves
// freshness at save time — useLinkMutations.update re-reads before merging) and
// optionally which section to land focused ('tags' for the menu's "Edit tags").
export interface LinkEditRequest {
  link: LinkView;
  focus?: 'tags';
}

interface LinksViewStateValue {
  // True while a repaint would disrupt the user: scrolled past the top, a row
  // menu is open, or a page-level dialog is up. useLinks stages sync results
  // while this holds.
  engaged: boolean;
  // The active layout's scroll position crossed (or returned to) the top.
  setScrolled: (scrolled: boolean) => void;
  // A row menu opened (true) or closed (false).
  setMenuOpen: (open: boolean) => void;
  // The link edit dialog: the open request (null = closed) and its controls.
  editing: LinkEditRequest | null;
  openEditor: (link: LinkView, focus?: 'tags') => void;
  closeEditor: () => void;
  // The permanent-delete confirmation: the link awaiting it (null = none).
  destroying: LinkView | null;
  requestDestroy: (link: LinkView) => void;
  closeDestroy: () => void;
}

const LinksViewStateContext = createContext<LinksViewStateValue | null>(null);

export function LinksViewStateProvider({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [openMenus, setOpenMenus] = useState(0);
  const [editing, setEditing] = useState<LinkEditRequest | null>(null);
  const [destroying, setDestroying] = useState<LinkView | null>(null);

  const setMenuOpen = useCallback((open: boolean) => {
    setOpenMenus((n) => Math.max(0, n + (open ? 1 : -1)));
  }, []);

  const openEditor = useCallback((link: LinkView, focus?: 'tags') => {
    setEditing({ link, focus });
  }, []);
  const closeEditor = useCallback(() => setEditing(null), []);

  const requestDestroy = useCallback((link: LinkView) => setDestroying(link), []);
  const closeDestroy = useCallback(() => setDestroying(null), []);

  const value = useMemo<LinksViewStateValue>(
    () => ({
      engaged: scrolled || openMenus > 0 || editing !== null || destroying !== null,
      setScrolled,
      setMenuOpen,
      editing,
      openEditor,
      closeEditor,
      destroying,
      requestDestroy,
      closeDestroy,
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
