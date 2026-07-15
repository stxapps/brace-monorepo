'use client';

// Quick-add for links: the popover behind the topbar's "Add" button. It's an
// EPHEMERAL action, not a view — so it lives in local state, never the URL (the
// page-provider header explains the split: shareable state goes in the URL,
// transient/private state does not). Anchored to its trigger (`align="end"`)
// rather than centered as a dialog, because it's launched from one specific
// button and should stay in that context; a heavier full editor (page copy, page
// content) is the future dialog/route, not this.
//
// Shape: a URL field always visible, an "Advanced" disclosure that reveals the
// list picker + tag editor + note, and Save/Cancel. Saving writes one
// `links/{id}.enc` via useLinkMutations and kicks a sync; the title is
// back-filled later by a metadata fetch, so the form only collects a URL
// (+ optional list/tags/note — the same create fields the extension editor sets).
//
// Validation is two-tier: an EMPTY URL is a hard, blocking error; a non-empty
// but MALFORMED URL, or one that's ALREADY SAVED, only warns and relabels
// Save → Confirm, so the user can save it as typed on a second click (we never
// block on a debatable-but-deliberate URL — re-saving can be intentional, and
// the local-first store can't guarantee URL uniqueness across devices anyway).
// Bare domains are fine — they're normalized to https:// on save. The list
// picker and tag editor are the shared ListSelect/TagsField (web-ui), the same
// pieces the extension editor and the edit dialog render.
//
// One state precedes all of that: a free library at its link cap can't save at
// all, so the popover renders the shared LinkQuotaBanner INSTEAD of the form
// (useLinkQuota — which also explains why this gate is load-bearing rather than
// cosmetic: an over-cap save wedges the sync queue on the server's 403).

import { useState } from 'react';
import { ChevronDown, Plus } from 'lucide-react';
import Link from 'next/link';

import {
  DEFAULT_LIST_ID,
  LINK_NOTE_MAX,
  normalizeUrl,
  PLAN_LABELS,
  TRASH_ID,
} from '@stxapps/shared';
import { readLinkByUrlKey, useLinkMutations, useLinkQuota } from '@stxapps/web-react';
import { LinkQuotaBanner } from '@stxapps/web-ui/components/links/link-quota-banner';
import { ListSelect } from '@stxapps/web-ui/components/links/list-select';
import { TagsField } from '@stxapps/web-ui/components/links/tags-field';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { Label } from '@stxapps/web-ui/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@stxapps/web-ui/components/ui/popover';
import { Textarea } from '@stxapps/web-ui/components/ui/textarea';
import { cn } from '@stxapps/web-ui/lib/utils';

import { useLinksPage } from '../_contexts/page-provider';

// The list to pre-select: the one the user is currently viewing (so "add" lands
// where they're looking), falling back to My List — the inbox — for the All view
// or a tag view, neither of which names a single destination list. Trash falls
// back too: it's the deletion staging area, never a place to add new links.
function useDefaultListId(): string {
  const { selection } = useLinksPage();
  return selection.kind === 'list' && selection.id !== TRASH_ID ? selection.id : DEFAULT_LIST_ID;
}

export function LinkAddPopover() {
  const { create } = useLinkMutations();
  const defaultListId = useDefaultListId();
  const { count, max, atLimit } = useLinkQuota();

  const [open, setOpen] = useState(false);
  const [openAdvanced, setOpenAdvanced] = useState(false);
  const [url, setUrl] = useState('');
  const [listId, setListId] = useState(defaultListId);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // urlError is a HARD, blocking error (empty URL); urlWarning is the SOFT
  // state that relabels Save → Confirm and lets the next submit through. Two
  // grounds, checked in order on submit — 'malformed' (can't normalize), then
  // 'duplicate' (already in the local store) — so a URL that's both warns on
  // each ground in turn. Editing the field disarms whichever is showing.
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlWarning, setUrlWarning] = useState<'malformed' | 'duplicate' | null>(null);

  // Reset to a clean draft whenever the popover opens; clear on close too so a
  // half-filled form never lingers. defaultListId is read at open time so the
  // pre-selection tracks the view the user opened it from.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setOpenAdvanced(false);
      setUrl('');
      setListId(defaultListId);
      setTagIds([]);
      setNote('');
      setUrlError(null);
      setUrlWarning(null);
    }
    setOpen(next);
  };

  const onSubmit = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (saving) return;

    const trimmed = url.trim();
    // Required: an empty URL is a hard error and blocks the save.
    if (trimmed === '') {
      setUrlError('Please enter a URL.');
      setUrlWarning(null);
      return;
    }
    setUrlError(null);

    // Soft: a URL we can't normalize only warns. The first submit arms the
    // warning and relabels Save → Confirm; submitting again (Confirm) saves the
    // raw text as typed. A normalizable value (incl. a bare domain) saves the
    // normalized https:// form.
    const normalized = normalizeUrl(trimmed);
    if (normalized === null && urlWarning === null) {
      setUrlWarning('malformed');
      return;
    }

    setSaving(true);
    try {
      // Soft, second ground: the URL is already saved. Matched by canonical
      // dedup identity (readLinkByUrlKey — folds scheme/www/trailing slash/query
      // order), so trivial variants of a saved link warn too. Only checked while
      // 'duplicate' is unarmed — an armed warning means the user has seen it, so
      // Confirm saves the duplicate deliberately.
      if (urlWarning !== 'duplicate') {
        const existing = await readLinkByUrlKey(normalized ?? trimmed);
        if (existing) {
          setUrlWarning('duplicate');
          return;
        }
      }

      await create({ url: normalized ?? trimmed, listId, tagIds, note: note.trim() || undefined });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  // Does closing now lose real work? A bare typed URL doesn't count — it's
  // cheap to retype and the click-away-to-dismiss popover idiom is worth more
  // than guarding it. Only the Advanced fields (note, tags, a non-default list)
  // represent effort worth protecting from a stray outside-click or Escape.
  const advancedDirty = note.trim() !== '' || tagIds.length > 0 || listId !== defaultListId;

  return (
    <Popover
      open={open}
      // Guard only the ACCIDENTAL close vectors (outside-click, Escape), and
      // only when the Advanced section holds work — swallow those so a stray
      // click can't drop a typed note or picked tags. The Cancel button calls
      // onOpenChange(false) directly, bypassing this, so a deliberate discard
      // stays one click.
      onOpenChange={(next) => {
        if (!next && advancedDirty) return;
        onOpenChange(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="default" size="sm">
          <Plus className="size-4" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        {atLimit && max !== null ? (
          <LinkQuotaBanner
            count={count}
            max={max}
            action={
              <Button asChild size="sm" className="self-end">
                <Link href="/settings/subscription">Upgrade to {PLAN_LABELS.plus}</Link>
              </Button>
            }
          />
        ) : (
          <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="link-url">URL</Label>
              <Input
                id="link-url"
                type="url"
                inputMode="url"
                placeholder="https://example.com"
                autoFocus
                aria-invalid={urlError !== null}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  // Editing re-opens the question: clear the error and disarm the
                  // warning so the button reverts to Save and re-validates.
                  setUrlError(null);
                  setUrlWarning(null);
                }}
              />
              {urlError !== null ? (
                <p role="alert" className="text-xs text-destructive">
                  {urlError}
                </p>
              ) : urlWarning !== null ? (
                <p role="alert" className="text-xs text-amber-600 dark:text-amber-500">
                  {urlWarning === 'malformed'
                    ? 'This doesn’t look like a valid URL. Click Confirm to save it anyway.'
                    : 'You’ve already saved this link. Click Confirm to save it again.'}
                </p>
              ) : null}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={openAdvanced}
              className="-mx-1 justify-between"
              onClick={() => setOpenAdvanced((v) => !v)}
            >
              Advanced
              <ChevronDown
                className={cn('size-4 transition-transform', openAdvanced && 'rotate-180')}
              />
            </Button>

            {openAdvanced && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="link-list">List</Label>
                  {/* No Trash target: it's the deletion staging area, never a place
                    to add new links (same rule as the default-list fallback).
                    Locked/hidden lists stay pickable — hiding only declutters the
                    sidebar, it never blocks filing into a list you know exists. */}
                  <ListSelect
                    id="link-list"
                    value={listId}
                    onValueChange={setListId}
                    excludeIds={[TRASH_ID]}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="link-tag">Tags</Label>
                  <TagsField id="link-tag" value={tagIds} onChange={setTagIds} />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="link-note">Note</Label>
                  <Textarea
                    id="link-note"
                    maxLength={LINK_NOTE_MAX}
                    placeholder="Optional note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="default" size="sm" disabled={saving}>
                {urlWarning !== null ? 'Confirm' : 'Save'}
              </Button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
