'use client';

// The bar above the main pane. Left: the static "Settings" title. Right: a close
// button that returns to the app (the links page) — the counterpart to the
// sidebar's back button, so either corner gets you out.

import { X } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@stxapps/web-ui/components/ui/button';

export function Topbar() {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
      <h1 className="truncate text-lg font-semibold">Settings</h1>

      <Button asChild variant="ghost" size="icon-sm" aria-label="Close settings">
        <Link href="/links">
          <X className="size-4" />
        </Link>
      </Button>
    </header>
  );
}
