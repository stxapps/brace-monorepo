'use client';

// Full-height left rail: brace mark at the top, then Show All, the lists (the
// My List / Archive / Trash system lists plus the user's own), and the user's
// tags as selectable filters. Clicking an entry sets the shared selection (see
// page-provider); the main pane reacts. "Show All" is the unfiltered reset.

import { Archive, Folder, Hash, Inbox, Layers, Settings2, Trash2 } from 'lucide-react';
import Link from 'next/link';

import { ALL_LABEL, ARCHIVE_ID, MY_LIST_ID, TRASH_ID, type TreeNode } from '@stxapps/shared';
import { BraceIcon } from '@stxapps/web-ui/components/icons/brace-icon';
import { cn } from '@stxapps/web-ui/lib/utils';

import { useLists } from '../_hooks/use-lists';
import { useTags } from '../_hooks/use-tags';
import { type Selection, useLinksPage } from './_contexts/page-provider';

import { type ListItem, type TagItem } from '@/data/queries';

// The icon for a list row: the system three keep their familiar marks, every
// user list is a folder.
function listIcon(id: string): React.ReactNode {
  if (id === MY_LIST_ID) return <Inbox className="size-4" />;
  if (id === ARCHIVE_ID) return <Archive className="size-4" />;
  if (id === TRASH_ID) return <Trash2 className="size-4" />;
  return <Folder className="size-4" />;
}

function isActive(current: Selection, candidate: Selection): boolean {
  if (current.kind !== candidate.kind) return false;
  if (current.kind === 'all') return true;
  return current.id === (candidate as Exclude<Selection, { kind: 'all' }>).id;
}

function NavItem({
  icon,
  label,
  selection,
  depth = 0,
}: {
  icon: React.ReactNode;
  label: string;
  selection: Selection;
  // Tree nesting level — indents the row one step per level.
  depth?: number;
}) {
  const { selection: current, setSelection } = useLinksPage();
  const active = isActive(current, selection);

  return (
    <button
      type="button"
      onClick={() => setSelection(selection)}
      aria-current={active ? 'true' : undefined}
      style={depth > 0 ? { paddingLeft: `${0.5 + depth * 0.875}rem` } : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        'hover:bg-muted',
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// One list subtree → rows, parents before their children, each indented by its
// depth. Selection is by the entity's own id, uniform for system and user lists.
function ListNodes({ nodes }: { nodes: TreeNode<ListItem>[] }) {
  return (
    <>
      {nodes.map((node) => (
        <ListNodes.Row key={node.item.id} node={node} />
      ))}
    </>
  );
}
ListNodes.Row = function Row({ node }: { node: TreeNode<ListItem> }) {
  return (
    <>
      <NavItem
        icon={listIcon(node.item.id)}
        label={node.item.name}
        selection={{ kind: 'list', id: node.item.id }}
        depth={node.depth}
      />
      <ListNodes nodes={node.children} />
    </>
  );
};

// Tag subtree → rows. Same shape as ListNodes, with the tag mark.
function TagNodes({ nodes }: { nodes: TreeNode<TagItem>[] }) {
  return (
    <>
      {nodes.map((node) => (
        <TagNodes.Row key={node.item.id} node={node} />
      ))}
    </>
  );
}
TagNodes.Row = function Row({ node }: { node: TreeNode<TagItem> }) {
  return (
    <>
      <NavItem
        icon={<Hash className="size-4" />}
        label={node.item.name}
        selection={{ kind: 'tag', id: node.item.id }}
        depth={node.depth}
      />
      <TagNodes nodes={node.children} />
    </>
  );
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="px-2 pt-3 pb-1 text-xs font-semibold tracking-wide text-muted-foreground/70 uppercase">
        {label}
      </h2>
      {children}
    </div>
  );
}

export function Sidebar() {
  const lists = useLists();
  const tags = useTags();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex h-14 items-center gap-2 px-4">
        <BraceIcon className="h-6 w-auto" />
        <span className="text-base font-semibold">Brace</span>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        <NavItem
          icon={<Layers className="size-4" />}
          label={ALL_LABEL}
          selection={{ kind: 'all' }}
        />

        {/* Lists: one ordered tree of the system three (My List / Archive / Trash)
            and the user's own lists, merged in the read layer and ordered by
            `rank`, nested by `parentId` (see use-lists). The system lists are code
            defaults (system-lists in @stxapps/shared), so they're always present;
            renaming/moving one just writes an override blob at its reserved id. */}
        <Section label="Lists">
          <ListNodes nodes={lists} />

          {/* Not a filter selection — a link out to the settings section that
              creates/renames/deletes lists. Styled like the items above but it's
              an <a>, so it navigates (and Back returns here to keep organizing)
              rather than calling setSelection. */}
          <Link
            href="/settings/lists"
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              'text-muted-foreground hover:bg-muted',
            )}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              <Settings2 className="size-4" />
            </span>
            <span className="truncate">Manage lists</span>
          </Link>
        </Section>

        {/* Tags are all user-created — no system tag — so this section is empty
            until the user makes one. */}
        <Section label="Tags">
          {tags.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">No tags yet</p>
          ) : (
            <TagNodes nodes={tags} />
          )}
        </Section>
      </nav>
    </aside>
  );
}
