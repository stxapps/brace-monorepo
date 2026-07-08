'use client';

// The topbar search: a persistent BASIC box (global word search over the combined
// url⊕title — the free rung) plus an ADVANCED popover (field-scoped url/title,
// multi-list/multi-tag — the Plus `searchEditor` rung). Both commit through
// `setQuery` (page-provider): they write the URL, and `query`/`selection` re-derive
// from it, so the box always reflects the committed query and a `?text=…` deep link
// rehydrates it.
//
// Basic search is GLOBAL by design (docs/business-model.md — "words, all links"):
// submitting the box replaces the whole query with just its text, so a search spans
// the library rather than the list you happened to be on. The advanced popover, by
// contrast, edits the FULL current query in place (WYSIWYG on the URL) — it snapshots
// the committed query on open, so it can refine what's already active.

import { useEffect, useId, useMemo, useState } from 'react';
import { Lock, Search, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';

import { flattenTree } from '@stxapps/shared';
import { emptyQuery, type LinkQuery, useEntitlements, useLists, useTags } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Checkbox } from '@stxapps/web-ui/components/ui/checkbox';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { Label } from '@stxapps/web-ui/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@stxapps/web-ui/components/ui/popover';

import { useLinksPage } from '../_contexts/page-provider';

// Split a raw field value into lowercased, trimmed words — the same normalization
// parseLinkQuery applies on read-back, done here so a multi-word field becomes the
// repeated-key form the grammar ANDs (`?text=foo&text=bar`).
function words(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

// Whether the committed query carries filters BEYOND a single-axis navigation
// selection (one list, one tag, or Show All) — i.e. the advanced editor is doing
// something the basic box can't show. Drives the trigger's active dot, so a user
// whose text box is empty still sees that url/title/list/tag filters are narrowing
// the view. Plain navigation (a list or tag picked in the sidebar) does NOT light it.
function hasAdvancedFilters(q: LinkQuery): boolean {
  const textish =
    q.url.all.length + q.url.any.length + q.url.none.length +
    q.title.all.length + q.title.any.length + q.title.none.length;
  if (textish > 0) return true;
  if (q.lists.none.length > 0 || q.lists.any.length > 1) return true;
  if (q.tags.all.length > 0 || q.tags.none.length > 0 || q.tags.any.length > 1) return true;
  // A list AND a tag together is already beyond a single-axis selection.
  return q.lists.any.length >= 1 && q.tags.any.length >= 1;
}

// The advanced popover's editable snapshot — raw strings for the word fields (so
// spaces survive mid-typing; split to words only on submit) and id lists for the
// multi-selects. Only the bare relations the UI emits (`*.all` words, `*.any`
// lists/tags); the suffixed none/all forms stay deep-link-only.
interface Draft {
  text: string;
  url: string;
  title: string;
  lists: string[];
  tags: string[];
}

function initDraft(q: LinkQuery): Draft {
  return {
    text: q.text.all.join(' '),
    url: q.url.all.join(' '),
    title: q.title.all.join(' '),
    lists: q.lists.any,
    tags: q.tags.any,
  };
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8"
      />
    </div>
  );
}

function MultiCheckList({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; name: string; depth: number }[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  if (options.length === 0) return null;
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="max-h-32 overflow-y-auto rounded-md border border-border p-1">
        {options.map((o) => (
          <label
            key={o.id}
            className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
            style={o.depth > 0 ? { paddingLeft: `${o.depth * 12 + 6}px` } : undefined}
          >
            <Checkbox checked={value.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
            <span className="truncate">{o.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// The Plus gate: field-scoped + multi-list/tag search is the `searchEditor`
// entitlement (docs/business-model.md). Free users see the trigger — visible, not
// hidden — but opening it presents the upgrade path rather than the fields.
function LockedGate() {
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Lock className="size-4" /> Advanced search
      </div>
      <p className="text-sm text-muted-foreground">
        Field-scoped search across URL and title, with multi-list and multi-tag filters, is a Plus
        feature. Basic word search stays free.
      </p>
      <Button asChild size="sm" className="mt-1">
        <Link href="/settings/subscription">Upgrade to Plus</Link>
      </Button>
    </div>
  );
}

function AdvancedSearch() {
  const { query, setQuery } = useLinksPage();
  const { entitlements } = useEntitlements();
  const lists = useLists();
  const tags = useTags();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => initDraft(query));

  // Snapshot the committed query into the draft each time the popover opens, so it
  // edits the CURRENT query rather than a stale one.
  const onOpenChange = (next: boolean) => {
    if (next) setDraft(initDraft(query));
    setOpen(next);
  };

  const listOptions = useMemo(
    () => flattenTree(lists).map((n) => ({ id: n.item.id, name: n.item.name, depth: n.depth })),
    [lists],
  );
  const tagOptions = useMemo(
    () => flattenTree(tags).map((n) => ({ id: n.item.id, name: n.item.name, depth: n.depth })),
    [tags],
  );

  const apply = () => {
    const q = emptyQuery();
    q.sort = query.sort; // ordering isn't a search field — keep the active sort
    q.text.all = words(draft.text);
    q.url.all = words(draft.url);
    q.title.all = words(draft.title);
    q.lists.any = draft.lists;
    q.tags.any = draft.tags;
    setQuery(q);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Advanced search" className="relative">
          <SlidersHorizontal className="size-4" />
          {hasAdvancedFilters(query) && (
            <span
              aria-hidden
              className="absolute top-1 right-1 size-1.5 rounded-full bg-primary"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
        {entitlements.searchEditor ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm font-medium">Advanced search</p>
            <TextField
              label="Text (URL or title)"
              value={draft.text}
              placeholder="words anywhere"
              onChange={(text) => setDraft((d) => ({ ...d, text }))}
            />
            <TextField
              label="URL contains"
              value={draft.url}
              onChange={(url) => setDraft((d) => ({ ...d, url }))}
            />
            <TextField
              label="Title contains"
              value={draft.title}
              onChange={(title) => setDraft((d) => ({ ...d, title }))}
            />
            <MultiCheckList
              label="Lists"
              options={listOptions}
              value={draft.lists}
              onChange={(l) => setDraft((d) => ({ ...d, lists: l }))}
            />
            <MultiCheckList
              label="Tags"
              options={tagOptions}
              value={draft.tags}
              onChange={(t) => setDraft((d) => ({ ...d, tags: t }))}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(initDraft(emptyQuery()))}>
                Clear
              </Button>
              <Button size="sm" onClick={apply}>
                Search
              </Button>
            </div>
          </div>
        ) : (
          <LockedGate />
        )}
      </PopoverContent>
    </Popover>
  );
}

export function SearchBar() {
  const { query, setQuery } = useLinksPage();

  // Basic box: a draft synced from the committed text. Navigation clears text → the
  // box empties; a basic/advanced search sets it → the box shows it.
  const committedText = useMemo(() => query.text.all.join(' '), [query.text.all]);
  const [text, setText] = useState(committedText);
  useEffect(() => setText(committedText), [committedText]);

  const submitBasic = () => {
    const w = words(text);
    // GLOBAL: replace the whole query with just the text (keeping sort). An empty
    // box returns home (the default inbox, via an empty query).
    if (w.length === 0) {
      setQuery(emptyQuery());
      return;
    }
    const q = emptyQuery();
    q.sort = query.sort;
    q.text.all = w;
    setQuery(q);
  };

  const clearBasic = () => {
    setText('');
    setQuery(emptyQuery());
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <form
        role="search"
        className="relative min-w-0 max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          submitBasic();
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search links…"
          aria-label="Search links"
          className="h-9 pr-8 pl-8"
        />
        {text.length > 0 && (
          <button
            type="button"
            onClick={clearBasic}
            aria-label="Clear search"
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        )}
      </form>
      <AdvancedSearch />
    </div>
  );
}
