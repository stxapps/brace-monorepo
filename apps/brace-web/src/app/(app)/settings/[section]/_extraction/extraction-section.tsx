'use client';

// The Extraction settings section: the opt-in toggle + link enrichment progress
// + the explicit full-library controls. Server extraction fills in a saved
// link's title/image via brace-extractor; the drain loop itself lives in
// web-react's ExtractionProvider (mounted in (app)/layout.tsx), so this section
// is a thin controls surface:
//   - the `serverExtraction` toggle (the privacy-load-bearing opt-in — no URL
//     leaves the browser until it's on), a synced setting read/written through
//     useSettings/useSettingMutations, colocated here with the controls it
//     governs rather than split off into Misc;
//   - progress from the free facet counts (done / pending / failed);
//   - "Extract all" to drain the WHOLE library (a conscious, potentially
//     thousands-of-requests job — so it confirms at the button first, per
//     docs/link-extraction.md), and "Pause" to stop it early.
// The whole feature is self-contained in this one section so a platform that
// does its own extraction (brace-expo) can drop it by omitting the section.
// The incidental, displayed-scoped auto drain is driven from the links pane
// (reportDisplayedLinkPaths) and needs no UI here.

import { useState } from 'react';
import { Pause, Sparkles } from 'lucide-react';

import { useExtraction, useSettingMutations, useSettings } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Label } from '@stxapps/web-ui/components/ui/label';
import { Switch } from '@stxapps/web-ui/components/ui/switch';

// One labelled count in a bordered tile.
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-border p-3">
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

export function ExtractionSection() {
  const {
    enabled,
    doneCount,
    pendingCount,
    failedCount,
    isRunning,
    isExtractingAll,
    autoLimitReached,
    extractAll,
    pause,
  } = useExtraction();

  // The opt-in itself. `enabled` above is the composite gate (signed in + store
  // ready + extractor configured + this), so the toggle binds to the raw
  // `serverExtraction` setting — flipping it on when e.g. no extractor is
  // configured still persists the preference; `enabled` just stays false.
  const { serverExtraction } = useSettings();
  const { setServerExtraction } = useSettingMutations();

  // Two-step confirm for "Extract all": the first click reveals the count +
  // Confirm, since draining the whole library can be thousands of paid requests.
  const [confirming, setConfirming] = useState(false);
  // Surface a failed toggle write (e.g. no active account) rather than swallow
  // it; the control stays live for a retry. Mirrors MiscSection's `run`.
  const [error, setError] = useState<string | null>(null);

  const setEnabled = (next: boolean) => {
    setError(null);
    void setServerExtraction(next).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  };

  const total = doneCount + pendingCount + failedCount;

  const startExtractAll = () => {
    setConfirming(false);
    extractAll();
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="text-xl font-semibold">Link previews</h2>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Brace fills in each saved link's title and preview image by fetching the page on the server.
        This happens automatically for the links you're viewing; use <strong>Generate all</strong>{' '}
        to preview your whole library at once.
      </p>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor="server-extraction" className="font-medium">
            Server-side previews
          </Label>
          <span className="text-sm font-normal text-muted-foreground">
            Fetch each link on the server to fill in its title and preview image. Your links' URLs
            are sent to the server only while this is on.
          </span>
        </div>
        <Switch
          id="server-extraction"
          checked={serverExtraction}
          onCheckedChange={setEnabled}
        />
      </div>

      {error && (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {serverExtraction && !enabled ? (
        <p className="mt-6 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Server-side previews are on but currently unavailable — they resume once you're signed in
          and the server is reachable.
        </p>
      ) : enabled ? (
        <div className="mt-6">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="With preview" value={doneCount} />
            <Stat label="Pending" value={pendingCount} />
            <Stat label="Failed" value={failedCount} />
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            {total === 0
              ? 'No links to preview yet.'
              : `${doneCount} of ${total} link${total === 1 ? '' : 's'} previewed.`}
          </p>

          {autoLimitReached && !isExtractingAll && (
            <p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Automatic previews paused for this session. Use <strong>Generate all</strong> to
              finish the remaining links.
            </p>
          )}

          <div className="mt-6">
            {isExtractingAll ? (
              <Button variant="outline" onClick={pause}>
                <Pause className="size-4" />
                {isRunning ? 'Generating… Pause' : 'Pause'}
              </Button>
            ) : confirming ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">
                  Generate previews for all {pendingCount} pending link
                  {pendingCount === 1 ? '' : 's'}? This sends a request per link to the server.
                </span>
                <div className="flex gap-2">
                  <Button onClick={startExtractAll}>Confirm</Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                disabled={pendingCount === 0}
                onClick={() => setConfirming(true)}
              >
                <Sparkles className="size-4" />
                Generate all
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
