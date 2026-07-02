'use client';

// Quick-add for links: the popover behind the topbar's "Add" button. It's an
// EPHEMERAL action, not a view — so it lives in local state, never the URL (the
// page-provider header explains the split: shareable state goes in the URL,
// transient/private state does not). Anchored to its trigger (`align="end"`)
// rather than centered as a dialog, because it's launched from one specific
// button and should stay in that context; a heavier full editor (archive, page
// content) is the future dialog/route, not this.
//
// Shape: a URL field always visible, an "Advanced" disclosure that reveals the
// list picker + tag editor, and Save/Cancel. Saving writes one `links/{id}.enc`
// via useLinkMutations and kicks a sync; the title is back-filled later by a
// metadata fetch, so the form only collects a URL (+ optional list/tags).
//
// Validation is two-tier: an EMPTY URL is a hard, blocking error; a non-empty
// but MALFORMED URL, or one that's ALREADY SAVED, only warns and relabels
// Save → Confirm, so the user can save it as typed on a second click (we never
// block on a debatable-but-deliberate URL — re-saving can be intentional, and
// the local-first store can't guarantee URL uniqueness across devices anyway).
// Bare domains are fine — they're normalized to https:// on save. The tag
// field stays simple: its "Add tag" button is just disabled while empty.

import { useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';

import { DEFAULT_LIST_ID, flattenTree, normalizeUrl, TRASH_ID } from '@stxapps/shared';
import {
  readLinkByUrl,
  useLinkMutations,
  useLists,
  useTagMutations,
  useTags,
} from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { Label } from '@stxapps/web-ui/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@stxapps/web-ui/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@stxapps/web-ui/components/ui/select';
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

export function LinkEditorPopover() {
  const { create } = useLinkMutations();
  const { findOrCreate: findOrCreateTag } = useTagMutations();
  const lists = useLists();
  const tags = useTags();
  const defaultListId = useDefaultListId();

  const [open, setOpen] = useState(false);
  const [openAdvanced, setOpenAdvanced] = useState(false);
  const [url, setUrl] = useState('');
  const [listId, setListId] = useState(defaultListId);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [saving, setSaving] = useState(false);
  // urlError is a HARD, blocking error (empty URL); urlWarning is the SOFT
  // state that relabels Save → Confirm and lets the next submit through. Two
  // grounds, checked in order on submit — 'malformed' (can't normalize), then
  // 'duplicate' (already in the local store) — so a URL that's both warns on
  // each ground in turn. Editing the field disarms whichever is showing.
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlWarning, setUrlWarning] = useState<'malformed' | 'duplicate' | null>(null);

  // Flat, depth-carrying rows for the pickers (the entities are trees). Lists
  // feed the dropdown; tags feed the chosen-chips lookup and the hint buttons.
  const listRows = flattenTree(lists);
  const tagRows = flattenTree(tags);
  const chosenTags = tagRows.filter((n) => tagIds.includes(n.item.id));
  // Hints = tags not yet chosen, narrowed by what's typed (case-insensitive
  // substring). Typing both filters the hints and names the tag to add.
  const tagQuery = tagInput.trim().toLowerCase();
  const hintTags = tagRows.filter(
    (n) => !tagIds.includes(n.item.id) && n.item.name.toLowerCase().includes(tagQuery),
  );

  // Reset to a clean draft whenever the popover opens; clear on close too so a
  // half-filled form never lingers. defaultListId is read at open time so the
  // pre-selection tracks the view the user opened it from.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setOpenAdvanced(false);
      setUrl('');
      setListId(defaultListId);
      setTagIds([]);
      setTagInput('');
      setUrlError(null);
      setUrlWarning(null);
    }
    setOpen(next);
  };

  const addTag = (id: string) => {
    setTagIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setTagInput('');
  };
  const removeTag = (id: string) => setTagIds((prev) => prev.filter((t) => t !== id));

  // "Add tag": reuse-or-mint by the typed name. findOrCreate returns the
  // existing tag when the name already exists (case-insensitive) and mints a new
  // top-level one otherwise, so retyping a known tag never forks a duplicate. The
  // live useTags query picks the new entity up, so its chip renders a beat later.
  const onAddTag = async () => {
    const name = tagInput.trim();
    if (name === '' || addingTag) return;
    setAddingTag(true);
    try {
      const tag = await findOrCreateTag(name);
      if (tag) addTag(tag.id);
    } finally {
      setAddingTag(false);
    }
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
      // Soft, second ground: the URL is already saved. Looked up by the exact
      // string create() would store (readLinkByUrl is an exact-match indexed
      // get, and links store the normalized url), only once per draft — an
      // armed 'duplicate' means the user has seen the warning, so Confirm
      // saves the duplicate deliberately.
      if (urlWarning !== 'duplicate') {
        const existing = await readLinkByUrl(normalized ?? trimmed);
        if (existing) {
          setUrlWarning('duplicate');
          return;
        }
      }

      await create({ url: normalized ?? trimmed, listId, tagIds });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="default" size="sm">
          <Plus className="size-4" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
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
                <Select value={listId} onValueChange={setListId}>
                  <SelectTrigger id="link-list" className="w-full">
                    <SelectValue placeholder="Choose a list" />
                  </SelectTrigger>
                  <SelectContent>
                    {listRows.map(({ item, depth }) => (
                      <SelectItem key={item.id} value={item.id}>
                        <span style={{ paddingLeft: depth * 12 }}>{item.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="link-tag">Tags</Label>
                <p className="text-xs text-muted-foreground">Type below or choose from hints</p>

                {chosenTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {chosenTags.map(({ item }) => (
                      <span
                        key={item.id}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                      >
                        {item.name}
                        <button
                          type="button"
                          aria-label={`Remove ${item.name}`}
                          onClick={() => removeTag(item.id)}
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex gap-1.5">
                  <Input
                    id="link-tag"
                    placeholder="Tag name"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onAddTag();
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={tagInput.trim() === '' || addingTag}
                    onClick={onAddTag}
                  >
                    Add tag
                  </Button>
                </div>

                {hintTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {hintTags.map(({ item }) => (
                      <Button
                        key={item.id}
                        type="button"
                        variant="secondary"
                        size="xs"
                        onClick={() => addTag(item.id)}
                      >
                        {item.name}
                      </Button>
                    ))}
                  </div>
                )}
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
      </PopoverContent>
    </Popover>
  );
}
