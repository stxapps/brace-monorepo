'use client';

// The Extraction settings section: link enrichment progress + the explicit
// full-library controls. Server extraction fills in a saved link's title/image
// via brace-extractor; the drain loop itself lives in web-react's
// ExtractionProvider (mounted in (app)/layout.tsx), so this section is a thin
// read/controls surface over `useExtraction()`:
//   - progress from the free facet counts (done / pending / failed);
//   - "Extract all" to drain the WHOLE library (a conscious, potentially
//     thousands-of-requests job — so it confirms at the button first, per
//     docs/link-extraction.md), and "Pause" to stop it early.
// The incidental, displayed-scoped auto drain is driven from the links pane
// (reportDisplayedLinkPaths) and needs no UI here.

import { useState } from 'react';
import { Pause, Sparkles } from 'lucide-react';

import { useExtraction } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';

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
  const { enabled, doneCount, pendingCount, failedCount, isRunning, isExtractingAll, autoLimitReached, extractAll, pause } =
    useExtraction();

  // Two-step confirm for "Extract all": the first click reveals the count +
  // Confirm, since draining the whole library can be thousands of paid requests.
  const [confirming, setConfirming] = useState(false);

  const total = doneCount + pendingCount + failedCount;

  const startExtractAll = () => {
    setConfirming(false);
    extractAll();
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h2 className="text-xl font-semibold">Extraction</h2>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Brace fills in each saved link's title and preview image by fetching it through the
        extractor. This happens automatically for the links you're viewing; use{' '}
        <strong>Extract all</strong> to enrich your whole library at once.
      </p>

      {!enabled ? (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          Server extraction is off. Turn it on in{' '}
          <strong>Settings → Misc.</strong> to enrich your links.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Enriched" value={doneCount} />
            <Stat label="Pending" value={pendingCount} />
            <Stat label="Failed" value={failedCount} />
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            {total === 0
              ? 'No links to enrich yet.'
              : `${doneCount} of ${total} link${total === 1 ? '' : 's'} enriched.`}
          </p>

          {autoLimitReached && !isExtractingAll && (
            <p className="mt-4 rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              Automatic enrichment paused for this session. Use <strong>Extract all</strong> to
              finish the remaining links.
            </p>
          )}

          <div className="mt-6">
            {isExtractingAll ? (
              <Button variant="outline" onClick={pause}>
                <Pause className="size-4" />
                {isRunning ? 'Enriching… Pause' : 'Pause'}
              </Button>
            ) : confirming ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm">
                  Enrich all {pendingCount} pending link{pendingCount === 1 ? '' : 's'}? This sends a
                  request per link to the extractor.
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
                Extract all
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
