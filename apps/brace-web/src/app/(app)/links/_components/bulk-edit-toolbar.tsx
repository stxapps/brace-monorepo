'use client';

// The toolbar shown while bulk-edit mode is on (view-state-provider
// `bulkEditing`): Select all + the selected count on the left, the actions on
// the right. It acts on the hoisted `selectedLinks` snapshot map; the one thing
// it takes from outside is `links` — the rows the active layout is showing
// (Main passes the same useLinks result it hands the layout) — which feeds
// Select all and puts the copied URLs in display order. The action set mirrors
// the row menu (LinkRowMenu) over the whole selection:
//
//   Select all — every loaded row (the growing-limit page useLinks currently
//               holds — bulk-edit mode holds `engaged`, so sync can't grow or
//               reorder it underneath; "Show more" can, dropping the checkbox
//               to indeterminate). Unchecking clears the selection without
//               leaving the mode.
//   Copy links — both views (it's the row menu's Copy link over the selection):
//               the selected URLs, newline-separated, in display order. Reads
//               only, so trashed links are included, and the label flips to
//               "Copied" for a beat as the only feedback a clipboard write gets.
//
// The rest follows the same view split as the row menu:
//
//   in Trash  — "Restore" (back to My List — the same `update({ listId })` the
//               row menu's Restore is) and "Delete permanently", the one
//               irreversible action, so it goes through the confirmation
//               (requestDestroy → LinkDestroyConfirm, which exits bulk-edit
//               mode after the destroy).
//   elsewhere — "Move to" (the same searchable ListCommand as the row menu's
//               submenu — no Trash target, trashing is Remove, never a "move"),
//               "Edit tags" (requestRetag → BulkTagsDialog), Pin/Unpin, then
//               the destructive pair: "Archive" (flipping to "Unarchive" in the
//               Archive view, like the row menu) and "Remove" (a reversible
//               move to Trash, so no confirmation).
//
// Keyed off the ACTIVE VIEW (the page selection), not each link's own listId —
// the toolbar is one button for the whole selection, and navigation exits
// bulk-edit mode (view-state-provider), so the selection always belongs to the
// view whose semantics the buttons show. One wrinkle the row menu doesn't have:
// a view can hold TRASHED links whose own row menu allows only Restore/destroy —
// so every non-Trash-view action here filters trashed links out of its targets
// (`actionable`), keeping the row menu's per-link semantics without forking the
// toolbar per link. Browsing can't produce that mix any more (use-links suppresses
// Trash outside the Trash view), but an advanced search that names Trash ALONGSIDE
// another list opts back in and resolves to no single-axis selection — so it lands
// here with the non-Trash buttons over a mixed selection. Each action also drops links
// already in its target state, so it never writes a no-op patch (which would
// bump updatedAt and reorder the date-modified sort).
//
// The button set is fixed per view and a button DISABLES when its target set is
// empty (rather than appearing/disappearing), so the toolbar doesn't reflow
// under the user mid-multi-select. One bulk action runs at a time (`busy`), and
// every completed action exits bulk-edit mode.

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArchiveRestore,
  Copy,
  FolderInput,
  Pin,
  PinOff,
  Tags,
  Trash2,
  Undo2,
} from 'lucide-react';

import { ARCHIVE_ID, DEFAULT_LIST_ID, TRASH_ID } from '@stxapps/shared';
import {
  linkIdOf,
  type LinkView,
  readPins,
  useLinkMutations,
  usePinMutations,
} from '@stxapps/web-react';
import { ListCommand } from '@stxapps/web-ui/components/links/list-command';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Checkbox } from '@stxapps/web-ui/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@stxapps/web-ui/components/ui/dropdown-menu';

import { useLinksPage } from '../_contexts/page-provider';
import { useLinksViewState } from '../_contexts/view-state-provider';

type BulkAction = 'restore' | 'move' | 'pin' | 'unpin' | 'archive' | 'remove';

export function BulkEditToolbar({ links }: { links: LinkView[] }) {
  const { selection } = useLinksPage();
  const {
    bulkEditing,
    exitBulkEdit,
    selectedLinks,
    selectAll,
    clearSelected,
    requestDestroy,
    requestRetag,
  } = useLinksViewState();
  const { update } = useLinkMutations();
  const { pin, unpin } = usePinMutations();
  const [busy, setBusy] = useState<BulkAction | null>(null);
  // Controlled for the same reason as the row menu: Move to selects via a
  // CommandItem, which Radix won't auto-close for.
  const [moveOpen, setMoveOpen] = useState(false);
  // The "Copied" flash on Copy links; the timer is cleared on unmount so a
  // pending flash can't set state on an unmounted toolbar.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // Live pin membership, so Pin/Unpin split the selection correctly even as a
  // pin lands from another device mid-selection.
  const pins = useLiveQuery(() => readPins(), []);

  if (!bulkEditing) return null;

  const inTrash = selection.kind === 'list' && selection.id === TRASH_ID;
  const inArchive = selection.kind === 'list' && selection.id === ARCHIVE_ID;
  const count = selectedLinks.size;
  const selected = [...selectedLinks.values()];

  // Non-Trash-view targets: never touch trashed links (see the header).
  const actionable = selected.filter((l) => l.listId !== TRASH_ID);
  const pinnedIds = new Set((pins ?? []).map((p) => p.id));
  const toPin = actionable.filter((l) => !pinnedIds.has(linkIdOf(l)));
  const toUnpin = actionable.filter((l) => pinnedIds.has(linkIdOf(l)));
  const toArchive = actionable.filter((l) => l.listId !== ARCHIVE_ID);

  // If the whole selection sits in one list (always true in a plain list view),
  // show it checked-but-disabled in Move to, like the row menu; a mixed
  // selection has no such list, so nothing is marked.
  const sharedListId =
    new Set(actionable.map((l) => l.listId)).size === 1 ? actionable[0].listId : undefined;

  const runBulk = async (
    action: BulkAction,
    links: LinkView[],
    op: (link: LinkView) => Promise<void>,
  ) => {
    if (busy) return;
    setBusy(action);
    try {
      for (const link of links) {
        await op(link);
      }
      exitBulkEdit();
    } finally {
      setBusy(null);
    }
  };

  const onMoveTo = (listId: string) => {
    setMoveOpen(false);
    const targets = actionable.filter((l) => l.listId !== listId);
    void runBulk('move', targets, (link) => update(link, { listId }));
  };

  const allSelected = links.length > 0 && links.every((l) => selectedLinks.has(l.path));

  const onCopy = async () => {
    // Display order, not click order — `links` is the layout's row order.
    const urls = links.filter((l) => selectedLinks.has(l.path)).map((l) => l.url);
    await navigator.clipboard.writeText(urls.join('\n'));
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const disabled = count === 0 || busy !== null;

  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-muted/30 px-4">
      <div className="flex items-center gap-3">
        <Checkbox
          aria-label="Select all"
          disabled={links.length === 0}
          checked={allSelected ? true : count > 0 ? 'indeterminate' : false}
          onCheckedChange={() => (allSelected ? clearSelected() : selectAll(links))}
        />
        <span className="text-sm text-muted-foreground">{count} selected</span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={() => void onCopy()}>
          <Copy className="size-4" />
          {copied ? 'Copied' : count === 1 ? 'Copy link' : 'Copy links'}
        </Button>
        {inTrash ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() =>
                void runBulk('restore', selected, (link) =>
                  update(link, { listId: DEFAULT_LIST_ID }),
                )
              }
            >
              <Undo2 className="size-4" />
              {busy === 'restore' ? 'Restoring…' : 'Restore'}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={disabled}
              onClick={() => requestDestroy(selected)}
            >
              <Trash2 className="size-4" />
              Delete permanently
            </Button>
          </>
        ) : (
          <>
            <DropdownMenu open={moveOpen} onOpenChange={setMoveOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={disabled || actionable.length === 0}>
                  <FolderInput className="size-4" />
                  {busy === 'move' ? 'Moving…' : 'Move to'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 p-0">
                <ListCommand
                  value={sharedListId}
                  excludeIds={[TRASH_ID]}
                  disabledIds={sharedListId ? [sharedListId] : undefined}
                  onSelect={onMoveTo}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || actionable.length === 0}
              onClick={() => requestRetag(actionable)}
            >
              <Tags className="size-4" />
              Edit tags
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || toPin.length === 0}
              onClick={() =>
                // Reversed so the first-selected link ends up topmost: pin()
                // inserts each at the top of the pinned section. Already-pinned
                // links are skipped, so their manual order isn't churned.
                void runBulk('pin', [...toPin].reverse(), (link) => pin(link))
              }
            >
              <Pin className="size-4" />
              {busy === 'pin' ? 'Pinning…' : 'Pin'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || toUnpin.length === 0}
              onClick={() => void runBulk('unpin', toUnpin, (link) => unpin(link))}
            >
              <PinOff className="size-4" />
              {busy === 'unpin' ? 'Unpinning…' : 'Unpin'}
            </Button>
            {inArchive ? (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  void runBulk('archive', actionable, (link) =>
                    update(link, { listId: DEFAULT_LIST_ID }),
                  )
                }
              >
                <ArchiveRestore className="size-4" />
                {busy === 'archive' ? 'Unarchiving…' : 'Unarchive'}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || toArchive.length === 0}
                onClick={() =>
                  void runBulk('archive', toArchive, (link) => update(link, { listId: ARCHIVE_ID }))
                }
              >
                <Archive className="size-4" />
                {busy === 'archive' ? 'Archiving…' : 'Archive'}
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              disabled={disabled || actionable.length === 0}
              onClick={() =>
                void runBulk('remove', actionable, (link) => update(link, { listId: TRASH_ID }))
              }
            >
              <Trash2 className="size-4" />
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </Button>
          </>
        )}
        <Button variant="ghost" size="sm" onClick={exitBulkEdit}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
