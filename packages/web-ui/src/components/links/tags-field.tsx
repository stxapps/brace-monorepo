'use client';

// The tag editor shared by the link editors (web quick-add popover, extension
// save editor, edit dialog): chosen-tag chips, a free-text "add tag" input, and
// hint buttons for the not-yet-chosen tags narrowed by what's typed. Controlled —
// the caller owns the chosen tag-id list; this component owns only the transient
// input/in-flight state. "Add tag" is reuse-or-mint by the typed name
// (useTagMutations.findOrCreate returns the existing tag on a case-insensitive
// name match and mints a new top-level one otherwise), so retyping a known tag
// never forks a duplicate; the live useTags query picks a new entity up, so its
// chip renders a beat later. Wired to web-react like ListSelect (and the auth
// forms) — see docs/architecture.md on the ui → react-logic layering.

import { useState } from 'react';
import { X } from 'lucide-react';

import { flattenTree } from '@stxapps/shared';
import { useTagMutations, useTags } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Input } from '@stxapps/web-ui/components/ui/input';

export function TagsField({
  id,
  value,
  onChange,
  autoFocus,
}: {
  // The labelled form-control id (htmlFor target), landing on the text input.
  id?: string;
  // The chosen tag ids, in chosen order.
  value: string[];
  onChange: (tagIds: string[]) => void;
  // Focus the text input on mount — for an editor opened straight onto tags.
  autoFocus?: boolean;
}) {
  const tags = useTags();
  const { findOrCreate } = useTagMutations();

  const [tagInput, setTagInput] = useState('');
  const [adding, setAdding] = useState(false);

  // Flat, depth-carrying rows (the entities are a tree): the chosen-chips lookup
  // and the hint buttons. Hints = tags not yet chosen, narrowed by what's typed
  // (case-insensitive substring) — typing both filters the hints and names the
  // tag to add.
  const rows = flattenTree(tags);
  const chosen = rows.filter((n) => value.includes(n.item.id));
  const query = tagInput.trim().toLowerCase();
  const hints = rows.filter(
    (n) => !value.includes(n.item.id) && n.item.name.toLowerCase().includes(query),
  );

  const addTag = (tagId: string) => {
    if (!value.includes(tagId)) onChange([...value, tagId]);
    setTagInput('');
  };

  const onAddTag = async () => {
    const name = tagInput.trim();
    if (name === '' || adding) return;
    setAdding(true);
    try {
      const tag = await findOrCreate(name);
      if (tag) addTag(tag.id);
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-muted-foreground">Type below or choose from hints</p>

      {chosen.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {chosen.map(({ item }) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
            >
              {item.name}
              <button
                type="button"
                aria-label={`Remove ${item.name}`}
                className="inline-flex"
                onClick={() => onChange(value.filter((t) => t !== item.id))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-1.5">
        <Input
          id={id}
          placeholder="Tag name"
          autoFocus={autoFocus}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void onAddTag();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={tagInput.trim() === '' || adding}
          onClick={() => void onAddTag()}
        >
          Add tag
        </Button>
      </div>

      {hints.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {hints.map(({ item }) => (
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
  );
}
