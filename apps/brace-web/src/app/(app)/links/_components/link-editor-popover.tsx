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
// list picker + tag editor, and Save/Cancel. Saving writes one `meta/{id}.enc`
// via useLinkMutations and kicks a sync; the title is back-filled later by a
// metadata fetch, so the form only collects a URL (+ optional list/tags).

import { useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';

import { DEFAULT_LIST_ID, flattenTree } from '@stxapps/shared';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { Label } from '@stxapps/web-ui/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@stxapps/web-ui/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@stxapps/web-ui/components/ui/select';
import { cn } from '@stxapps/web-ui/lib/utils';

import { useLinkMutations } from '../../_hooks/use-link-mutations';
import { useLists } from '../../_hooks/use-lists';
import { useTagMutations } from '../../_hooks/use-tag-mutations';
import { useTags } from '../../_hooks/use-tags';
import { useLinksPage } from '../_contexts/page-provider';

// The list to pre-select: the one the user is currently viewing (so "add" lands
// where they're looking), falling back to My List — the inbox — for the All view
// or a tag view, neither of which names a single destination list.
function useDefaultListId(): string {
  const { selection } = useLinksPage();
  return selection.kind === 'list' ? selection.id : DEFAULT_LIST_ID;
}

export function LinkEditorPopover() {
  const { create } = useLinkMutations();
  const { findOrCreate } = useTagMutations();
  const lists = useLists();
  const tags = useTags();
  const defaultListId = useDefaultListId();

  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [url, setUrl] = useState('');
  const [listId, setListId] = useState(defaultListId);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [addingTag, setAddingTag] = useState(false);
  const [saving, setSaving] = useState(false);

  // Flat, depth-carrying rows for the pickers (the entities are trees). Lists
  // feed the dropdown; tags feed the chosen-chips lookup and the hint buttons.
  const listRows = flattenTree(lists);
  const tagRows = flattenTree(tags);
  const chosenTags = tagRows.filter((n) => tagIds.includes(n.item.id));
  // Hints = tags not yet chosen, narrowed by what's typed (case-insensitive
  // substring). Typing both filters the hints and names the tag to add.
  const query = tagInput.trim().toLowerCase();
  const hintTags = tagRows.filter(
    (n) => !tagIds.includes(n.item.id) && n.item.name.toLowerCase().includes(query),
  );

  // Reset to a clean draft whenever the popover opens; clear on close too so a
  // half-filled form never lingers. defaultListId is read at open time so the
  // pre-selection tracks the view the user opened it from.
  const onOpenChange = (next: boolean) => {
    if (next) {
      setAdvanced(false);
      setUrl('');
      setListId(defaultListId);
      setTagIds([]);
      setTagInput('');
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
      const tag = await findOrCreate(name);
      if (tag) addTag(tag.id);
    } finally {
      setAddingTag(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (url.trim() === '' || saving) return;
    setSaving(true);
    try {
      await create({ url, listId, tagIds });
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
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-url">URL</Label>
            <Input
              id="link-url"
              type="url"
              inputMode="url"
              placeholder="https://example.com"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={advanced}
            className="-mx-1 justify-between"
            onClick={() => setAdvanced((v) => !v)}
          >
            Advanced
            <ChevronDown className={cn('size-4 transition-transform', advanced && 'rotate-180')} />
          </Button>

          {advanced && (
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
                <p className="text-xs text-muted-foreground">
                  Type below or choose from hints
                </p>

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
            <Button type="submit" variant="default" size="sm" disabled={url.trim() === '' || saving}>
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
