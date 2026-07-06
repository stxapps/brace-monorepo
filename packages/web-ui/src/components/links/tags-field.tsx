'use client';

// The tag editor shared by the link editors (web quick-add popover, extension
// save editor, edit dialog): a token combobox. Chosen tags render as removable
// chips in the trigger; opening it drops a searchable, multi-select TagsCommand
// (the tag sibling of ListSelect/ListCommand) whose list IS the "pick an
// existing tag" affordance — the old always-on hint section, now folded into the
// popover and searchable — and whose Create row mints a new tag. Controlled: the
// caller owns the chosen tag-id list; this owns only the popover open state.
// Reuse-or-mint is by name (useTagMutations.findOrCreate, case-insensitive), so
// retyping a known tag never forks a duplicate; the live useTags query renders
// the chip a beat later. Wired to web-react like ListSelect (and the auth
// forms) — see docs/architecture.md on the ui → react-logic layering.

import { useId, useMemo, useState } from 'react';
import { ChevronsUpDownIcon, X } from 'lucide-react';

import { flattenTree } from '@stxapps/shared';
import { useTagMutations, useTags } from '@stxapps/web-react';
import { Popover, PopoverContent, PopoverTrigger } from '@stxapps/web-ui/components/ui/popover';
import { cn } from '@stxapps/web-ui/lib/utils';

import { TagsCommand } from './tags-command';

export function TagsField({
  id,
  value,
  onChange,
  autoFocus,
}: {
  // The labelled form-control id (htmlFor target), landing on the trigger.
  id?: string;
  // The chosen tag ids, in chosen order.
  value: string[];
  onChange: (tagIds: string[]) => void;
  // Open the picker on mount — for an editor opened straight onto tags. The
  // token-combobox analog of focusing the old text field: focus lands in the
  // command's search input.
  autoFocus?: boolean;
}) {
  const tags = useTags();
  const { findOrCreate } = useTagMutations();
  const [open, setOpen] = useState(Boolean(autoFocus));
  // aria-controls target: names the popover's list so the combobox trigger is
  // valid even while the content is unmounted (closed).
  const listId = useId();

  // Chosen chips: map ids → names off the live tree. An id with no row yet (a
  // just-minted tag useTags hasn't surfaced) is skipped until it catches up.
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of flattenTree(tags)) m.set(n.item.id, n.item.name);
    return m;
  }, [tags]);
  const chosen = value
    .map((tid) => ({ id: tid, name: nameById.get(tid) }))
    .filter((t): t is { id: string; name: string } => t.name !== undefined);

  const toggle = (tagId: string) => {
    onChange(value.includes(tagId) ? value.filter((t) => t !== tagId) : [...value, tagId]);
  };
  const create = async (name: string) => {
    const tag = await findOrCreate(name);
    if (tag && !value.includes(tag.id)) onChange([...value, tag.id]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* A div, not a Button: each chip carries its own ✕ button, and a button
            nested in a button is invalid HTML. role/tabIndex + the key handler
            give it the combobox affordances by hand (Radix wires the click). */}
        <div
          id={id}
          role="combobox"
          aria-controls={listId}
          aria-expanded={open}
          tabIndex={0}
          className={cn(
            'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-2xl border border-input',
            'bg-input/30 px-3 py-1.5 text-sm outline-none',
            'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
          )}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
            }
          }}
        >
          {chosen.length > 0 ? (
            chosen.map((t) => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
              >
                {t.name}
                <button
                  type="button"
                  aria-label={`Remove ${t.name}`}
                  className="inline-flex"
                  // Don't let removing a chip open the popover.
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange(value.filter((id) => id !== t.id));
                  }}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))
          ) : (
            <span className="text-muted-foreground">Add tags</span>
          )}
          <ChevronsUpDownIcon className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </div>
      </PopoverTrigger>
      {/* Not portalled — same reason as ListSelect: this also opens inside the
          edit Dialog, whose modal scroll-lock would swallow wheel/trackpad
          scrolling over a body-portalled popover. */}
      <PopoverContent
        id={listId}
        align="start"
        portal={false}
        className="w-(--radix-popover-trigger-width) min-w-56 p-0"
      >
        <TagsCommand value={value} onToggle={toggle} onCreate={create} />
      </PopoverContent>
    </Popover>
  );
}
