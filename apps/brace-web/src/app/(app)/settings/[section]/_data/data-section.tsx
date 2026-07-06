'use client';

// The Data settings section: the home for everything about the bytes you own —
// sync status up top, then the three data-lifecycle actions (import / export /
// delete-all). It mirrors the old SettingsPopupData's shape (an overview that
// lists the actions, each opening a focused screen with a Back link) but as
// in-section VIEW STATE rather than routes: the settings model is one static
// route per top-level section, so these transient one-shot screens live as a
// local `view` swap inside this one section, self-contained in `_data/` like
// the other sections.
//
// NOTE: the import / export / delete-all ACTIONS are stubbed — the buttons are
// wired to `// TODO` handlers and the progress/result UI isn't built yet. Only
// the shell (navigation, sync status, the delete confirm gate) is real.

import { useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Download,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';

import { formatSyncedAt, getSyncPhase, SYNC_PHASE_LABELS } from '@stxapps/shared';
import { usePendingChangesCount, useSync } from '@stxapps/web-react';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { Checkbox } from '@stxapps/web-ui/components/ui/checkbox';
import { Label } from '@stxapps/web-ui/components/ui/label';

type DataView = 'overview' | 'import' | 'export' | 'delete';

// The sync status card: collapses the two sync dimensions into one phase
// (@stxapps/shared's getSyncPhase — same derivation as the extension popup)
// with an icon, an optional detail, and the single relevant action (Sync now /
// Retry). Sync is status-based, not a percentage, so there's no progress bar;
// the pending-changes line is the "how much is left" signal instead.
function SyncStatus() {
  const { storeStatus, bgSyncStatus, lastSyncAt, lastError, requestSync, retryInitialSync } =
    useSync();
  const pendingCount = usePendingChangesCount();
  const phase = getSyncPhase(storeStatus, bgSyncStatus);
  const isError = phase === 'initial-error' || phase === 'cycle-error';

  const icon = isError ? (
    <CircleAlert className="size-4 text-destructive" />
  ) : phase === 'idle' ? (
    <CircleCheck className="size-4 text-muted-foreground" />
  ) : (
    <Loader2 className="size-4 animate-spin text-muted-foreground" />
  );

  const text =
    phase === 'idle' && lastSyncAt
      ? `Last synced ${formatSyncedAt(lastSyncAt)}`
      : SYNC_PHASE_LABELS[phase];
  const detail = phase === 'cycle-error' ? lastError : null;
  const action =
    phase === 'initial-error'
      ? { label: 'Retry', onClick: retryInitialSync }
      : phase === 'cycle-error'
        ? { label: 'Retry', onClick: requestSync }
        : phase === 'idle'
          ? { label: 'Sync now', onClick: requestSync }
          : null;

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">Sync</span>
          <span className={`text-sm ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>
            {text}
          </span>
          {detail && <span className="wrap-break-words text-sm text-destructive">{detail}</span>}
          {pendingCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {pendingCount} {pendingCount === 1 ? 'change' : 'changes'} waiting to sync
            </span>
          )}
        </div>
      </div>
      {action && (
        <Button variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

// One tappable row on the overview that opens a sub-view. Full-width button with
// a leading icon, a title + description, and a trailing chevron affordance.
function ActionRow({
  icon,
  title,
  description,
  onClick,
  destructive,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className={`shrink-0 ${destructive ? 'text-destructive' : 'text-muted-foreground'}`}>
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`font-medium ${destructive ? 'text-destructive' : ''}`}>{title}</span>
        <span className="text-sm text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// The back link shared by every sub-view — returns to the overview.
function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-4 -ml-1 inline-flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <ChevronLeft className="size-4" />
      Data
    </button>
  );
}

function ImportView({ onBack }: { onBack: () => void }) {
  const onChooseFile = () => {
    // TODO: implement import — read the file, parse links, write to the store.
  };
  return (
    <div>
      <BackLink onBack={onBack} />
      <h2 className="text-xl font-semibold">Import data</h2>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Import from a text file — a plain list of links, or a file exported from another
        read-it-later app, a bookmark manager, or Brace. Large imports may take a few minutes.
      </p>
      <Button variant="outline" onClick={onChooseFile}>
        <Upload className="size-4" />
        Choose a file
      </Button>
    </div>
  );
}

function ExportView({ onBack }: { onBack: () => void }) {
  const onExport = () => {
    // TODO: implement export — gather all data and download it as a text file.
  };
  return (
    <div>
      <BackLink onBack={onBack} />
      <h2 className="text-xl font-semibold">Export all data</h2>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Download all your data to your device as a text file. This may take a few minutes for a
        large library.
      </p>
      <Button variant="outline" onClick={onExport}>
        <Download className="size-4" />
        Export all data
      </Button>
    </div>
  );
}

function DeleteView({ onBack }: { onBack: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  // Reveal the "tick the box first" nudge only after a click without the box.
  const [nudge, setNudge] = useState(false);

  const onDelete = () => {
    if (!confirmed) {
      setNudge(true);
      return;
    }
    setNudge(false);
    // TODO: implement delete-all — wipe all links, lists, tags, and settings.
  };

  return (
    <div>
      <BackLink onBack={onBack} />
      <h2 className="text-xl font-semibold">Delete all data</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Delete all your data — every saved link in every list, all your lists and tags, and all your
        settings.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        This removes your data only, not your account — you can still sign in. It may take a few
        minutes.
      </p>
      <p className="mt-3 text-sm font-medium text-destructive">This action cannot be undone.</p>

      <Label
        htmlFor="delete-confirm"
        className="mt-6 flex items-start gap-3 rounded-lg border border-border p-3"
      >
        <Checkbox
          id="delete-confirm"
          checked={confirmed}
          onCheckedChange={(v) => {
            setConfirmed(v === true);
            setNudge(false);
          }}
          className="mt-0.5"
        />
        <span className="text-sm font-normal">
          Yes, I&apos;m absolutely sure I want to delete all my data.
        </span>
      </Label>

      {nudge && (
        <p className="mt-2 text-sm text-destructive">Please tick the box above to confirm.</p>
      )}

      <div className="mt-6">
        <Button variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4" />
          Delete all data
        </Button>
      </div>
    </div>
  );
}

export function DataSection() {
  const [view, setView] = useState<DataView>('overview');

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {view === 'overview' ? (
        <>
          <h2 className="text-xl font-semibold">Data</h2>
          <p className="mt-1 mb-6 text-sm text-muted-foreground">
            Your data syncs across your devices, end-to-end encrypted. Import, export, or delete all
            of it here.
          </p>

          <SyncStatus />

          <div className="mt-6 flex flex-col gap-3">
            <ActionRow
              icon={<Upload className="size-5" />}
              title="Import data"
              description="Add links from a text file or another app."
              onClick={() => setView('import')}
            />
            <ActionRow
              icon={<Download className="size-5" />}
              title="Export all data"
              description="Download everything as a text file."
              onClick={() => setView('export')}
            />
            <ActionRow
              icon={<Trash2 className="size-5" />}
              title="Delete all data"
              description="Permanently remove all your data."
              onClick={() => setView('delete')}
              destructive
            />
          </div>
        </>
      ) : view === 'import' ? (
        <ImportView onBack={() => setView('overview')} />
      ) : view === 'export' ? (
        <ExportView onBack={() => setView('overview')} />
      ) : (
        <DeleteView onBack={() => setView('overview')} />
      )}
    </div>
  );
}
