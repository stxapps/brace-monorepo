'use client';

// Full-height left rail for the settings page: a back-to-the-app button pinned
// top-right, then the section menu (Account, Subscription, Lists, Tags, Miscs.,
// About). Clicking an entry sets the shared section (see settings-page-provider);
// the main pane renders the matching content.

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@stxapps/web-ui/components/ui/button';
import { cn } from '@stxapps/web-ui/lib/utils';

import { SETTINGS_SECTIONS, type SettingsSection } from './sections';
import { useSettingsPage } from './settings-page-provider';

function NavItem({ section }: { section: SettingsSection }) {
  const { section: current, setSection } = useSettingsPage();
  const active = current === section.id;

  return (
    <button
      type="button"
      onClick={() => setSection(section.id)}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        'hover:bg-muted',
        active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{section.icon}</span>
      <span className="truncate">{section.label}</span>
    </button>
  );
}

export function Sidebar() {
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-background">
      <div className="flex h-14 items-center justify-end px-4">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back">
          <Link href="/links">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-4">
        {SETTINGS_SECTIONS.map((section) => (
          <NavItem key={section.id} section={section} />
        ))}
      </nav>
    </aside>
  );
}
