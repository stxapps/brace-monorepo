'use client';

// The list picker shared by the link editors — the web quick-add popover, the
// extension's save editor, and the edit dialog — so the three surfaces render one
// flat, depth-indented Select over the same live list tree instead of drifting.
// Wired straight to web-react's useLists, the same way the auth forms pair shared
// field UI with their web-react submit hooks (docs/architecture.md — web-ui may
// depend on the React-logic layer, never the reverse).

import { flattenTree } from '@stxapps/shared';
import { useLists } from '@stxapps/web-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@stxapps/web-ui/components/ui/select';

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
  const lists = useLists();
  const rows = flattenTree(lists).filter(({ item }) => !excludeIds?.includes(item.id));

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder="Choose a list" />
      </SelectTrigger>
      <SelectContent>
        {rows.map(({ item, depth }) => (
          <SelectItem key={item.id} value={item.id}>
            <span style={{ paddingLeft: depth * 12 }}>{item.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
