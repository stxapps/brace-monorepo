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

import { useEffect, useMemo, useState } from 'react';
import { Lock, Search, SlidersHorizontal, X } from 'lucide-react';
import Link from 'next/link';

import { flattenTree } from '@stxapps/shared';
import { emptyQuery, type LinkQuery, useEntitlements, useLists, useTags } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Checkbox } from '@stxapps/web-ui/components/ui/checkbox';
import { Field, FieldLabel } from '@stxapps/web-ui/components/ui/field';
import { Input } from '@stxapps/web-ui/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@stxapps/web-ui/components/ui/popover';

import { useLinksPage } from '../_contexts/page-provider';

import { usePaywall } from '@/contexts/paywall-provider';

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

// Whether the committed query narrows the view in a way the rest of the UI does NOT
// already show. Drives the trigger's active dot. The UI has exactly two ways to
// render a filter — the basic box (which shows `text.all`) and the sidebar highlight
// (`selection`) — so the dot lights precisely when those two don't account for the
// whole query. Plain navigation (a list or tag picked in the sidebar) does NOT light
// it; neither does a bare global text search.
function hasAdvancedFilters(q: LinkQuery): boolean {
  // Substring predicates the basic box cannot render (it shows `text.all` only —
  // the any/none forms are deep-link-only, and initDraft ignores them too).
  const hidden =
    q.text.any.length +
    q.text.none.length +
    q.url.all.length +
    q.url.any.length +
    q.url.none.length +
    q.title.all.length +
    q.title.any.length +
    q.title.none.length;
  if (hidden > 0) return true;
  if (q.lists.none.length > 0 || q.tags.all.length > 0 || q.tags.none.length > 0) return true;

  // Past this point the box shows `text.all` and the sidebar can highlight ONE list
  // or tag — but never both: a text clause makes `selection` resolve to `none`
  // (page-provider's `selectionFromQuery`, which drops the highlight rather than let
  // it go stale during a search). So any list/tag sitting alongside text is
  // unrepresented on screen, and the dot is the only thing left to surface it.
  const lists = q.lists.any.length;
  const tags = q.tags.any.length;
  if (lists > 1 || tags > 1) return true;
  if (lists >= 1 && tags >= 1) return true;
  return q.text.all.length > 0 && lists + tags > 0;
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
// entitlement (docs/business-model.md). Free users get the FULL editor to try —
// visible and interactive (a banner names it as Plus) — and the gate fires only
// when they press Search, which routes to the paywall instead of committing. This
// "let them build, then upgrade at the payoff" beats hiding the fields: the wall
// lands at peak intent, and nothing sensitive is thrown away (unlike locks, which
// gate before their password dialog).
//
// The banner's own "See plans" link is the door for the user who wants the offer
// WITHOUT first building a query to trigger it — pressing Search still routes to
// the paywall, which stays the primary, peak-intent path. (Contrast the link cap,
// which replaces its form with LinkQuotaBanner and skips the paywall entirely:
// there the action is impossible, whereas this one is a click away.)
function LockedBanner() {
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
      <Lock className="mt-0.5 size-3.5 shrink-0" />
      <span>
        A <span className="font-medium text-foreground">Plus</span> feature. Build your query, then
        upgrade to run it.{' '}
        <Link
          href="/settings/subscription"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          See plans
        </Link>
      </span>
    </div>
  );
}

function AdvancedSearch() {
  const { query, setQuery } = useLinksPage();
  const { entitlements } = useEntitlements();
  const paywall = usePaywall();
  const lists = useLists();
  const tags = useTags();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => initDraft(query));
  // True while the paywall is layered over an OPEN popover (free user pressed
  // Search). We keep the popover open underneath so "Not now" returns the user to
  // their built query, untouched — hence we ignore Radix's close requests while
  // gated, and clear it from the paywall's onDismiss.
  const [gated, setGated] = useState(false);

  // Snapshot the committed query into the draft each time the popover opens, so it
  // edits the CURRENT query rather than a stale one. While gated, refuse close
  // requests (a focus-out to the modal paywall) so the popover — and the draft —
  // survive a "Not now".
  const onOpenChange = (next: boolean) => {
    if (gated && !next) return;
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
    // The gate: a free user built a query to try the feature — pressing Search is
    // the payoff moment, so route to the paywall instead of committing. Keep the
    // popover open behind it (gated) so backing out with "Not now" leaves their
    // query exactly as they built it.
    if (!entitlements.searchEditor) {
      setGated(true);
      paywall.show('searchEditor', () => setGated(false));
      return;
    }
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
            <span aria-hidden className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-80 overflow-y-auto"
        // Belt-and-suspenders with the onOpenChange guard: the modal paywall's
        // focus grab must not dismiss the popover underneath it.
        onInteractOutside={(e) => gated && e.preventDefault()}
        onFocusOutside={(e) => gated && e.preventDefault()}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Advanced search</p>
          {!entitlements.searchEditor && <LockedBanner />}
          <Field className="gap-1">
            <FieldLabel htmlFor="adv-text" className="text-xs font-normal text-muted-foreground">
              Text (URL or title)
            </FieldLabel>
            <Input
              id="adv-text"
              value={draft.text}
              placeholder="words anywhere"
              onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
              className="h-8"
            />
          </Field>
          <Field className="gap-1">
            <FieldLabel htmlFor="adv-url" className="text-xs font-normal text-muted-foreground">
              URL contains
            </FieldLabel>
            <Input
              id="adv-url"
              value={draft.url}
              onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
              className="h-8"
            />
          </Field>
          <Field className="gap-1">
            <FieldLabel htmlFor="adv-title" className="text-xs font-normal text-muted-foreground">
              Title contains
            </FieldLabel>
            <Input
              id="adv-title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              className="h-8"
            />
          </Field>
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
        className="relative max-w-md min-w-0 flex-1"
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
