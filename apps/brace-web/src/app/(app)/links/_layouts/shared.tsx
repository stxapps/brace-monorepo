'use client';

// Bits common to all three link layouts: the props contract, an empty state, a
// "show more" footer, and a couple of presentation helpers. Each layout owns its
// own scroll container + virtualizer (row geometry differs per layout), so this
// is deliberately just the shared chrome, not a base component.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Copy,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Tags,
  Trash2,
  Undo2,
} from 'lucide-react';

import {
  ARCHIVE_ID,
  DEFAULT_LIST_ID,
  hostFromText,
  TRASH_ID,
  type TreeNode,
} from '@stxapps/shared';
import {
  type LinkView,
  type TagItem,
  useExtraction,
  useImageFileUrl,
  useLinkMutations,
  usePinMutations,
  useTags,
} from '@stxapps/web-react';
import { ListCommand } from '@stxapps/web-ui/components/links/list-command';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Checkbox } from '@stxapps/web-ui/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@stxapps/web-ui/components/ui/dropdown-menu';

import { useLinksPage } from '../_contexts/page-provider';
import { useLinksViewState } from '../_contexts/view-state-provider';

export interface LinkLayoutProps {
  // Display-resolved rows (link joined with its extraction): `link.title` /
  // `link.imageId` are the override-wins resolved values — see LinkView.
  links: LinkView[];
  // Leading `pinnedCount` entries of `links` are pinned, in pin-rank order (top
  // first). A row at index `i` is pinned iff `i < pinnedCount`; it's the topmost
  // pin at `i === 0` and the bottom pin at `i === pinnedCount - 1`.
  pinnedCount: number;
  hasMore: boolean;
  showMore: () => void;
  isLoading: boolean;
  // A background sync has newer results being held back; render the RefreshPill.
  hasPending: boolean;
  // Swap the held results in (the pill's click also scrolls the layout to top).
  applyPending: () => void;
}

// How long the displayed window must hold still before we report it. Virtual scrolling moves
// the window every frame; debouncing to the trailing edge reports where the user SETTLES (and
// only those rows), not every transient window a fast scroll flew past.
const REPORT_SETTLE_MS = 300;

// Report the on-screen link window to the automatic-extraction loop (extraction-provider), so
// it extracts what the user is actually looking at — the "displayed" set the provider drains
// (see `reportDisplayedLinkPaths`). Bounded to O(displayed) — a few dozen rows — no matter how
// far "show more" has grown `links`: reporting the whole loaded page instead would re-scan
// thousands of paths on every probe re-run (the provider's liveQuery fires on each store
// write). Each layout owns a virtualizer with its own geometry, so it resolves the displayed
// LINK index range itself and passes [startIndex, endIndex] (inclusive); this maps the range to
// paths, debounced to the scroll's trailing edge. MUST be called unconditionally before a
// layout's empty-state early return (hooks rule); an empty range (`endIndex < 0`) reports `[]`,
// which pauses the loop — matching `reportDisplayedLinkPaths`'s "no links shown" contract.
export function useReportDisplayedLinkPaths(
  links: LinkView[],
  startIndex: number,
  endIndex: number,
): void {
  const { reportDisplayedLinkPaths } = useExtraction();

  useEffect(() => {
    const id = setTimeout(() => {
      const paths: string[] = [];
      for (let i = Math.max(0, startIndex); i <= endIndex && i < links.length; i++) {
        paths.push(links[i].path);
      }
      reportDisplayedLinkPaths(paths);
    }, REPORT_SETTLE_MS);

    return () => clearTimeout(id);
  }, [links, startIndex, endIndex, reportDisplayedLinkPaths]);
}

// Google's favicon service — no key, cached at the edge. Render with
// referrerPolicy="no-referrer" (every call site does): the request itself still
// discloses each rendered link's HOST to Google, which is the one third-party
// leak left in the app — the planned fix is capturing the favicon in the
// titleImage extraction facet as an encrypted `files/` blob, riding the same
// local pipeline as LinkPreviewImage. The display host comes from
// `hostFromText` (@stxapps/shared) so it matches the secondary line.
export function faviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(hostFromText(url))}`;
}

// The link's preview-image slot. The resolved bytes are local-first: `imageId`
// is the row's override-wins image ref (LinkView), read from Dexie and fetched
// on demand by useImageFileUrl the moment the row mounts (rows are virtualized,
// so mounted = displayed). Until bytes exist — or when the link has no image at
// all — the slot shows the site favicon on a muted background, so the
// placeholder still identifies the link and the geometry never shifts. Both
// call sites pass a FIXED-size `className` (the layouts' row estimates depend
// on it).
export function LinkPreviewImage({
  link,
  className,
  iconClassName,
}: {
  link: LinkView;
  className: string;
  iconClassName: string;
}) {
  const url = useImageFileUrl(link.imageId);

  if (url) {
    return <img src={url} alt="" className={`object-cover ${className}`} />;
  }
  return (
    <div className={`flex items-center justify-center bg-muted ${className}`}>
      <img
        src={faviconUrl(link.url)}
        alt=""
        referrerPolicy="no-referrer"
        className={iconClassName}
        loading="lazy"
      />
    </div>
  );
}

// Flatten the live tag tree into an id → name map, hoisted ONCE per layout and
// passed to the rows (a per-row useTags would mount one liveQuery per virtual
// row). Live, so a rename repaints the chips immediately — tag names are
// deliberately NOT part of useLinks' staged snapshot: a rename isn't a row
// reorder, so it must never wait behind the refresh pill.
export function useTagMap(): Map<string, string> {
  const tree = useTags();
  return useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: TreeNode<TagItem>[]): void => {
      for (const node of nodes) {
        map.set(node.item.id, node.item.name);
        walk(node.children);
      }
    };
    walk(tree);
    return map;
  }, [tree]);
}

// The row's tag chips: one button per tag, in the link's own `tagIds` order,
// each navigating to that tag's view via setSimpleQuery — the same canonical
// `/links?tag=…` URL the sidebar writes, so highlight/back-button behavior comes
// for free. Rendered OUTSIDE the row's <a> (a button inside an anchor is invalid
// and would fire the navigation — same rule as LinkRowMenu). In bulk-edit mode a
// chip toggles the row's selection instead, matching the row click. Ids the map
// doesn't know (a tag deleted / not yet synced) are skipped; no tags renders
// nothing. The base is a NON-wrapping, overflow-hidden single line — the rows
// are fixed-height — and the card layout opts into clamped wrapping via
// `className`.
export function LinkTagChips({
  link,
  tagsById,
  className = '',
}: {
  link: LinkView;
  tagsById: Map<string, string>;
  className?: string;
}) {
  const { setSimpleQuery } = useLinksPage();
  const { bulkEditing, toggleSelected } = useLinksViewState();

  const tags = link.tagIds.flatMap((id) => {
    const name = tagsById.get(id);
    return name === undefined ? [] : [{ id, name }];
  });
  if (tags.length === 0) return null;

  return (
    <div className={`flex gap-1 overflow-hidden ${className}`}>
      {tags.map(({ id, name }) => (
        <button
          key={id}
          type="button"
          className="max-w-32 shrink-0 truncate rounded-full bg-secondary px-2 py-px text-[11px] font-medium text-secondary-foreground hover:bg-secondary/80"
          onClick={() => (bulkEditing ? toggleSelected(link) : setSimpleQuery({ kind: 'tag', id }))}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ isLoading }: { isLoading: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">
      {isLoading ? 'Loading links…' : 'No links here yet.'}
    </div>
  );
}

// The per-row options menu — every row action lives here so each layout renders
// one `<LinkRowMenu>` and the logic stays in one place. The shape follows the
// menu convention: frequent actions first (Copy link / Edit / Move to / Edit
// tags / pin), destructive last behind a separator (Archive / Remove). The
// variant is keyed off the LINK's own `listId`, not the active view, so a
// trashed/archived link gets the right menu in the All view and tag views too:
//
//   in Trash   — Copy link / Restore / — / Delete permanently. No edit/move/pin:
//                Trash is the deletion staging area, and permanent delete is the
//                one irreversible action, so it goes through a confirmation
//                (view-state-provider `requestDestroy` → LinkDestroyConfirm).
//   in Archive — "Archive" flips to "Unarchive"; everything else as normal.
//
// Edit and Edit tags both open the page-level edit dialog (the latter landing
// focused on the tag field) via the hoisted `openEditor` — a row-owned dialog
// could be unmounted by a sync repaint mid-edit. Move to / Archive / Restore /
// Remove are all one `update({ listId })` — thin wrappers over the same op the
// dialog's Save uses. `pinned` swaps the pin block between "Pin to top" and the
// pinned set (move up/down + unpin); `isFirst`/`isLast` disable the move that
// would fall off the pinned section's ends.
//
// The menu is a sibling of the row's link, never nested inside the `<a>` — a
// button inside an anchor is invalid and would also fire the navigation. The
// wrapper stops click/keydown from bubbling so opening the menu never triggers the
// row. Dropdown content is portaled, so item clicks are outside the row entirely.
export function LinkRowMenu({
  link,
  pinned,
  isFirst,
  isLast,
}: {
  link: LinkView;
  pinned: boolean;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { pin, unpin, moveUp, moveDown } = usePinMutations();
  const { update } = useLinkMutations();
  // Report open/close so a background sync won't repaint the row (moving or
  // unmounting this trigger) while the menu is open — see view-state-provider. Track
  // our own open state so an unmount-while-open (e.g. a layout switch) releases
  // the count instead of leaking it and pinning `engaged` true forever. The menu is
  // CONTROLLED because Move to selects via a CommandItem, not a DropdownMenuItem —
  // Radix won't auto-close for it, so the select handler closes explicitly.
  const { setMenuOpen, openEditor, requestDestroy } = useLinksViewState();
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  useEffect(
    () => () => {
      if (openRef.current) setMenuOpen(false);
    },
    [setMenuOpen],
  );
  const handleOpenChange = (nextOpen: boolean) => {
    openRef.current = nextOpen;
    setOpen(nextOpen);
    setMenuOpen(nextOpen);
  };

  const inTrash = link.listId === TRASH_ID;
  const inArchive = link.listId === ARCHIVE_ID;

  const copyLink = (
    <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(link.url)}>
      <Copy className="size-4" />
      Copy link
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          aria-label="Link options"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {inTrash ? (
          <>
            {copyLink}
            <DropdownMenuItem onSelect={() => void update(link, { listId: DEFAULT_LIST_ID })}>
              <Undo2 className="size-4" />
              Restore
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => requestDestroy([link])}>
              <Trash2 className="size-4" />
              Delete permanently
            </DropdownMenuItem>
          </>
        ) : (
          <>
            {copyLink}
            <DropdownMenuItem onSelect={() => openEditor(link)}>
              <Pencil className="size-4" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="size-4" />
                Move to
              </DropdownMenuSubTrigger>
              {/* The same searchable list command as ListSelect (list-command.tsx).
                  No Trash target — trashing is Remove, never a "move". The link's
                  current list stays visible but disabled (and checked), keeping the
                  tree's shape (and the user's bearings) intact. Locked/hidden lists
                  stay pickable: hiding only declutters the sidebar, it never blocks
                  filing a link into a list you know exists. */}
              <DropdownMenuSubContent className="w-64 p-0">
                <ListCommand
                  value={link.listId}
                  excludeIds={[TRASH_ID]}
                  disabledIds={[link.listId]}
                  onSelect={(listId) => {
                    void update(link, { listId });
                    handleOpenChange(false);
                  }}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={() => openEditor(link, 'tags')}>
              <Tags className="size-4" />
              Edit tags
            </DropdownMenuItem>
            {pinned ? (
              <>
                <DropdownMenuItem disabled={isFirst} onSelect={() => void moveUp(link)}>
                  <ArrowUp className="size-4" />
                  Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={isLast} onSelect={() => void moveDown(link)}>
                  <ArrowDown className="size-4" />
                  Move down
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void unpin(link)}>
                  <PinOff className="size-4" />
                  Unpin
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={() => void pin(link)}>
                <Pin className="size-4" />
                Pin to top
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {inArchive ? (
              <DropdownMenuItem onSelect={() => void update(link, { listId: DEFAULT_LIST_ID })}>
                <ArchiveRestore className="size-4" />
                Unarchive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => void update(link, { listId: ARCHIVE_ID })}>
                <Archive className="size-4" />
                Archive
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => void update(link, { listId: TRASH_ID })}
            >
              <Trash2 className="size-4" />
              Remove
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The bulk-edit stand-in for LinkRowMenu: each layout swaps its menu slot for
// this checkbox while `bulkEditing` is on, so the row geometry stays put. Sized
// to the menu trigger's footprint (size-8) so the swap doesn't shift the row.
// It toggles the same hoisted selection the row's own click does (in bulk mode
// the layouts intercept the anchor click) — the checkbox is the visible state
// plus a small dedicated target, not a separate mechanism.
export function LinkRowSelect({ link }: { link: LinkView }) {
  const { selectedLinks, toggleSelected } = useLinksViewState();

  return (
    <span className="flex size-8 shrink-0 items-center justify-center">
      <Checkbox
        checked={selectedLinks.has(link.path)}
        onCheckedChange={() => toggleSelected(link)}
        aria-label="Select link"
      />
    </span>
  );
}

// A small pin glyph marking a pinned row at a glance.
export function PinnedBadge() {
  return <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />;
}

interface ShowMoreProps {
  hasMore: boolean;
  showMore: () => void;
}

export function ShowMore({ hasMore, showMore }: ShowMoreProps) {
  if (!hasMore) return null;

  return (
    <div className="flex justify-center py-4">
      <Button variant="outline" size="sm" onClick={showMore}>
        Show more
      </Button>
    </div>
  );
}

// The "new updates" affordance: a floating pill shown when a background sync has
// results held back (useLinks `hasPending`). It must be placed inside a
// `relative` wrapper that does NOT scroll (a sibling of the scroll container), so
// it stays pinned to the top of the pane instead of riding the scrolled content.
// Clicking applies the held results AND scrolls the layout to top, so the
// reorder lands where the user can see it rather than shifting them mid-list.
interface RefreshPillProps {
  show: boolean;
  onClick: () => void;
}

export function RefreshPill({ show, onClick }: RefreshPillProps) {
  if (!show) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center">
      <Button size="sm" onClick={onClick} className="pointer-events-auto rounded-full shadow-md">
        <RefreshCw className="size-4" />
        New updates
      </Button>
    </div>
  );
}
