'use client';

// The Miscs settings section: small app-wide preferences. Today it owns the link
// LAYOUT — list / card / table — which used to live as a quick switch in the links
// topbar. Moving it here makes it a choose-once setting and unlocks the sync/device
// split the topbar couldn't express.
//
// Two tabs select WHERE the choice lives, and the selected tab IS the active
// source (use-settings.ts resolves `layoutMode` from it):
//   - Sync   → settings/general.enc, shared across the user's devices;
//   - Device → the off-sync localSettings store, this device only (wiped on sign-out).
// Each tab shows the same three layout radios bound to that source's value, so
// switching tabs both changes which value applies and reveals it for editing.

import { useState } from 'react';
import { LayoutGrid, List, Table } from 'lucide-react';

import { LINK_LAYOUTS, type LinkLayout } from '@stxapps/shared';
import { Label } from '@stxapps/web-ui/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@stxapps/web-ui/components/ui/radio-group';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@stxapps/web-ui/components/ui/tabs';

import { useSettingMutations } from '../../../_hooks/use-setting-mutations';
import { type LayoutSource, useSettings } from '../../../_hooks/use-settings';

const LAYOUT_OPTIONS: Record<LinkLayout, { label: string; hint: string; icon: React.ReactNode }> = {
  list: { label: 'List', hint: 'A dense, single-column list.', icon: <List className="size-4" /> },
  card: {
    label: 'Card',
    hint: 'A grid of preview cards.',
    icon: <LayoutGrid className="size-4" />,
  },
  table: {
    label: 'Table',
    hint: 'Columns with a header row.',
    icon: <Table className="size-4" />,
  },
};

// The three layout radios for one source. `value`/`onChange` are wired to either
// the synced or the device layout by the parent, so this row is source-agnostic.
function LayoutRadioGroup({
  value,
  onChange,
}: {
  value: LinkLayout;
  onChange: (layout: LinkLayout) => void;
}) {
  return (
    <RadioGroup value={value} onValueChange={(v) => onChange(v as LinkLayout)} className="mt-4">
      {LINK_LAYOUTS.map((layout) => {
        const { label, hint, icon } = LAYOUT_OPTIONS[layout];
        return (
          <Label
            key={layout}
            htmlFor={`layout-${layout}`}
            className="flex items-start gap-3 rounded-lg border border-border p-3 has-data-checked:border-primary has-data-checked:bg-muted/40"
          >
            <RadioGroupItem id={`layout-${layout}`} value={layout} className="mt-0.5" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 font-medium">
                {icon}
                {label}
              </span>
              <span className="text-sm font-normal text-muted-foreground">{hint}</span>
            </span>
          </Label>
        );
      })}
    </RadioGroup>
  );
}

export function MiscsSection() {
  const { layoutSource, syncLayout, deviceLayout } = useSettings();
  const { setLayoutSource, setSyncLayout, setDeviceLayout } = useSettingMutations();
  const [error, setError] = useState<string | null>(null);

  // Surface a failed write (e.g. the synced write with no active account) rather
  // than swallowing it; the radios stay live for a retry.
  const run = (op: Promise<unknown>) => {
    setError(null);
    void op.catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="text-xl font-semibold">Miscs.</h2>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        General preferences for the app.
      </p>

      <section>
        <h3 className="text-base font-medium">Link layout</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose how your saved links are displayed. <strong>Sync</strong> applies your choice
          across all your devices. <strong>Device</strong> keeps a separate choice for this device
          only (cleared when you sign out).
        </p>

        {error && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Tabs
          value={layoutSource}
          onValueChange={(v) => run(setLayoutSource(v as LayoutSource))}
          className="mt-4"
        >
          <TabsList>
            <TabsTrigger value="sync">Sync</TabsTrigger>
            <TabsTrigger value="device">Device</TabsTrigger>
          </TabsList>

          {/* One radio group per tab, each bound to that source's value. The active
              tab is the active source (use-settings.ts), so the shown radios always
              reflect the layout the app is rendering. */}
          <TabsContent value="sync">
            <LayoutRadioGroup value={syncLayout} onChange={(l) => run(setSyncLayout(l))} />
          </TabsContent>
          <TabsContent value="device">
            <LayoutRadioGroup value={deviceLayout} onChange={(l) => run(setDeviceLayout(l))} />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}
