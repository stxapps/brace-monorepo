'use client';

// The list picker shared by the link editors — the web quick-add popover, the
// extension's save editor, and the edit dialog — so the three surfaces render one
// picker over the same live list tree instead of drifting. Wired straight to
// web-react's useLists (via list-command), the same way the auth forms pair
// shared field UI with their web-react submit hooks (docs/architecture.md —
// web-ui may depend on the React-logic layer, never the reverse).
//
// A Combobox: a form-control trigger opening ListCommand (list-command.tsx),
// which owns the search/tree/path rendering. The trigger shows the selected
// list's ancestor path — the popup row's context shouldn't vanish once it
// closes. Query state resets on close because the popover unmounts its content.

import { useState } from 'react';
import { ChevronsUpDownIcon } from 'lucide-react';

import { Button } from '@stxapps/web-ui/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@stxapps/web-ui/components/ui/popover';

import { ListCommand, useListRows } from './list-command';

export function ListSelect({
  id,
  value,
  onValueChange,
  excludeIds,
}: {
  // The labelled form-control id (htmlFor target), landing on the trigger.
  id?: string;
  value: string;
  onValueChange: (listId: string) => void;
  // List ids to leave out of the options — e.g. Trash in the editors, where
  // trashing is its own explicit action, never a "move". Trash is a leaf
  // (LIST_NO_CHILDREN_IDS), so excluding it never orphans indented children.
  excludeIds?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const selected = useListRows(excludeIds).find((row) => row.item.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {selected ? (
            <span className="truncate">
              {selected.ancestors.length > 0 && (
                <span className="text-muted-foreground">
                  {selected.ancestors.join(' / ')}
                  {' / '}
                </span>
              )}
              {selected.item.name}
            </span>
          ) : (
            <span className="text-muted-foreground">Choose a list</span>
          )}
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      {/* Not portalled: this picker also opens inside the edit Dialog, whose
          modal scroll-lock would otherwise swallow wheel/trackpad scrolling
          over a body-portalled popover (see PopoverContent's `portal`). */}
      <PopoverContent
        align="start"
        portal={false}
        className="w-(--radix-popover-trigger-width) min-w-48 p-0"
      >
        <ListCommand
          value={value}
          excludeIds={excludeIds}
          onSelect={(listId) => {
            onValueChange(listId);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
