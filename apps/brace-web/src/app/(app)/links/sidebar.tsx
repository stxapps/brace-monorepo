'use client';

// Full-height left rail: brace mark at the top, then Show All, the lists (the
// My List / Archive / Trash system lists plus the user's own), and the user's
// tags as selectable filters. Clicking an entry sets the shared selection (see
// links-page-provider); the main pane reacts. "Show All" is the unfiltered reset.

import { Archive, Folder, Hash, Inbox, Layers, Trash2 } from 'lucide-react';

import { ARCHIVE_ID, MY_LIST_ID, TRASH_ID } from '@stxapps/shared';
import { BraceIcon } from '@stxapps/web-ui/components/icons/brace-icon';
import { cn } from '@stxapps/web-ui/lib/utils';

import { useLists } from './hooks/use-lists';
import { useTags } from './hooks/use-tags';
import { type Selection,useLinksPage } from './links-page-provider';

function isActive(current: Selection, candidate: Selection): boolean {
  if (current.kind !== candidate.kind) return false;
  if (current.kind === 'all') return true;
  return current.id === (candidate as Exclude<Selection, { kind: 'all' }>).id;
}

function NavItem({
  icon,
  label,
  selection,
}: {
  icon: React.ReactNode;
  label: string;
  selection: Selection;
}) {
  const { selection: current, setSelection } = useLinksPage();
  const active = isActive(current, selection);

  return (
    <button
      type="button"
      onClick={() => setSelection(selection)}
      aria-current={active ? 'true' : undefined}
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
        <NavItem icon={<Layers className="size-4" />} label="Show All" selection={{ kind: 'all' }} />

        {/* Lists: My List (the default inbox) on top, the user's own lists in the
            middle, then Archive and Trash pinned at the bottom — the familiar
            inbox-first / system-last layout. The system three are virtual (see
            system-lists in @stxapps/shared), so they're always present. */}
        <Section label="Lists">
          <NavItem
            icon={<Inbox className="size-4" />}
            label="My List"
            selection={{ kind: 'list', id: MY_LIST_ID }}
          />
          {lists.map((list) => (
            <NavItem
              key={list.path}
              icon={<Folder className="size-4" />}
              label={list.name}
              selection={{ kind: 'list', id: list.id }}
            />
          ))}
          <NavItem
            icon={<Archive className="size-4" />}
            label="Archive"
            selection={{ kind: 'list', id: ARCHIVE_ID }}
          />
          <NavItem
            icon={<Trash2 className="size-4" />}
            label="Trash"
            selection={{ kind: 'list', id: TRASH_ID }}
          />
        </Section>

        {/* Tags are all user-created — no system tag — so this section is empty
            until the user makes one. */}
        <Section label="Tags">
          {tags.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground/60">No tags yet</p>
          ) : (
            tags.map((tag) => (
              <NavItem
                key={tag.path}
                icon={<Hash className="size-4" />}
                label={tag.name}
                selection={{ kind: 'tag', id: tag.id }}
              />
            ))
          )}
        </Section>
      </nav>
    </aside>
  );
}
