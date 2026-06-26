'use client';

// The server-extraction LOOP DRIVER for a web React app — the counterpart of the
// extension's background-alarm sweep (apps/brace-extension/entrypoints/background.ts),
// realized as a React provider because brace-web has no background service worker:
// the sync engine already runs in-page (SyncProvider), and so does this.
//
// It does NOT hang off the save path (useLinkMutations.create is untouched). Per
// docs/link-extraction.md ("the queue is a query, not a structure"; "everything is
// async; nothing blocks the save"), the trigger is OBSERVING pending state, not the
// save call — which is what makes it cover cross-device saves and bulk imports for
// free (all just rows the same `readLinksPendingTitleImage` query returns), and keeps
// the save off the network.
//
// COST CONTROL — why this isn't a naive "drain everything while the tab is open".
// Each pending link is a paid `brace-extractor` request (HTML fetch + maybe an image
// proxy). A bulk import (tens of thousands of links) left draining unbounded in an
// open — possibly ABANDONED — tab would bill the server for work no one is watching.
// The doc sizes the SYNC poll to the backlog but never the SERVER-REQUEST rate, so
// that ceiling is imposed here, in three layers:
//
//   1. Visibility gate. The drain runs only while the tab is VISIBLE; hiding it
//      pauses, revealing it resumes. An abandoned/backgrounded tab spends nothing.
//   2. Auto budget. The automatic drain handles only the INCIDENTAL residual —
//      cross-device saves, small backfills — capped at AUTO_BUDGET links per session.
//      Past that it stops and flips `autoLimitReached`, so a bulk import can't
//      silently rack up thousands of requests.
//   3. Explicit "enrich all". Draining the whole library is a CONSCIOUS, user-driven
//      job: `enrichAll()` lifts the auto cap (still visibility-gated), `pause()` stops
//      it. The bulk import is the opt-in moment the doc names — surfaced via the
//      context below (counts + controls) so the app can show "X of Y enriched —
//      [Enrich all] / [Pause]" rather than draining behind the user's back.
//
// The loop, gated on the opt-in + a ready store + visibility:
//   liveQuery(pending titleImage) wakes it → drain in paced batches, until the
//   backlog is empty, the auto budget is spent (auto mode), the tab hides, or the
//   user pauses:
//     for each link: runServerTitleImage (extract → resize → write `files/` +
//     `extractions/`) → requestSync() to push → re-scan → repeat.
// A `failed` link is marked + backed-off, so it drops out of the scan and the loop
// always terminates (no tight retry spin).
//
// The server's per-IP egress budget + rate/size/time caps (docs/link-extraction.md
// "server extraction") remain the non-negotiable FLOOR: the gates here are UX/cost
// shaping for the honest client; the extractor's own caps bound the bill regardless.

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { type ExtractClient } from '@stxapps/shared';

import { readExtractionFacetCounts, readLinksPendingTitleImage } from '../data/queries';
import { useSettings } from '../hooks/use-settings';
import { runServerTitleImage } from '../lib/server-extraction';
import { useAuth } from './auth-provider';
import { useSync } from './sync-provider';

// How many links one drain step processes before pushing and re-scanning. Small so
// the work is visibly incremental (each batch syncs, the list fills in) and naturally
// paced — `brace-extractor` is single-URL + IP-rate-limited, so we stay sequential
// within a batch rather than fanning out.
const BATCH = 5;

// The INCIDENTAL ceiling: how many links the AUTOMATIC drain processes per session
// before it stops and waits for an explicit `enrichAll()`. Sized to cover the genuine
// residual (a handful to dozens of cross-device saves) while ensuring a bulk import
// can never auto-bill the server for thousands of requests in an open tab. Resets per
// mount/session — declining the opt-in or just leaving costs nothing further; a big
// library enriches a chunk per visit, or all-at-once when the user asks.
const AUTO_BUDGET = 100;

interface ExtractionContextValue {
  // Is server extraction live at all (opted in, store ready, extractor configured)?
  // When false, every count is 0 and the controls are no-ops.
  enabled: boolean;
  // Progress, for an indicator. From `readExtractionFacetCounts` (a free index read):
  // `done` ran, `failed` was attempted and failed (incl. permanent), `pending` is
  // not-yet-attempted. `pending` excludes `failed` — a backed-off retry shows under
  // `failed`, not `pending`.
  doneCount: number;
  pendingCount: number;
  failedCount: number;
  // A drain is actively processing right now (some request is in flight).
  isRunning: boolean;
  // User-initiated "enrich all" mode is on (the auto cap is lifted until `pause()`).
  isActive: boolean;
  // The automatic drain hit AUTO_BUDGET with work still pending — the app should
  // surface "enrich the rest?" rather than continue silently.
  autoLimitReached: boolean;
  // Start the explicit full-library drain (lifts the auto cap; still visibility-gated).
  enrichAll: () => void;
  // Stop the active drain; nothing auto-resumes until `enrichAll()` is called again.
  pause: () => void;
}

const ExtractionContext = createContext<ExtractionContextValue | null>(null);

const EMPTY_COUNTS = { done: 0, pending: 0, failed: 0 };

function isDocumentVisible(): boolean {
  // SSR / first render before hydration: assume visible so the gate doesn't wedge.
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

export function ExtractionProvider({
  children,
  extractClient,
}: {
  children: ReactNode;
  // The app's env-bound `brace-extractor` client, or null when no extractor origin is
  // configured — in which case the loop is permanently inert (server extraction off).
  extractClient: ExtractClient | null;
}) {
  const { username } = useAuth();
  const { storeStatus, requestSync } = useSync();
  const { serverExtraction } = useSettings();

  // Every condition the loop needs, in one gate. The opt-in is the privacy-load-
  // bearing one: no URL leaves the browser until `serverExtraction` is true.
  const enabled =
    Boolean(username) && storeStatus === 'ready' && serverExtraction && extractClient !== null;

  // Pause the drain while the tab is hidden, so an abandoned/backgrounded tab spends
  // nothing. `visible` (state) re-runs the effect to resume; `visibleRef` lets the
  // running loop notice mid-drain and stop at the next iteration.
  const [visible, setVisible] = useState(isDocumentVisible);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  // Progress counts for the indicator. liveQuery re-runs on every `db.items` change,
  // so the numbers tick up as extractions land — the same query the loop's pending
  // scan is built from (docs: "progress is free").
  const counts =
    useLiveQuery(
      () => (enabled ? readExtractionFacetCounts() : Promise.resolve(EMPTY_COUNTS)),
      [enabled],
    ) ?? EMPTY_COUNTS;

  // Cheap local wake signal: is there any titleImage pending AND ELIGIBLE right now
  // (respects backoff — unlike the display `pendingCount`, which excludes `failed`)?
  // The scan is a bounded index read (docs: "the local queue scan is free"), and
  // liveQuery re-runs it whenever `db.items` changes — a fresh save, an import, or a
  // sync landing a cross-device link — so the drain is reactive without a fixed poll.
  const probe = useLiveQuery(
    () => (enabled ? readLinksPendingTitleImage(Date.now(), 1) : Promise.resolve([])),
    [enabled],
  );
  const hasWork = (probe?.length ?? 0) > 0;

  // Remaining AUTOMATIC budget for this session — decremented per link in auto mode,
  // ignored in active mode. Held in a ref (not state) so spending it doesn't re-render.
  const budgetRef = useRef(AUTO_BUDGET);
  // User-initiated mode flag the loop reads live; mirrored to `isActive` state for the
  // UI and to re-trigger the drain effect on toggle.
  const activeRef = useRef(false);
  const [isActive, setIsActive] = useState(false);
  const [autoLimitReached, setAutoLimitReached] = useState(false);

  // Single-flight the drain: a wake while one is running sets `rerun` so it loops once
  // more at the end, instead of overlapping.
  const runningRef = useRef(false);
  const rerunRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);

  const enrichAll = useCallback(() => {
    activeRef.current = true;
    setAutoLimitReached(false);
    setIsActive(true);
  }, []);

  const pause = useCallback(() => {
    activeRef.current = false;
    // Spend the rest of the auto budget too, so Pause fully stops rather than letting
    // the incidental drain quietly carry on. A later enrichAll() is the only resume.
    budgetRef.current = 0;
    setIsActive(false);
  }, []);

  useEffect(() => {
    if (!enabled || !username || !extractClient || !hasWork || !visible) return;

    let cancelled = false;

    const drain = async () => {
      if (runningRef.current) {
        rerunRef.current = true;
        return;
      }
      runningRef.current = true;
      setIsRunning(true);
      try {
        for (;;) {
          if (cancelled || !visibleRef.current) return;
          // Auto mode stops at the budget; active mode (enrichAll) ignores it.
          if (!activeRef.current && budgetRef.current <= 0) {
            setAutoLimitReached(true);
            break;
          }
          const take = activeRef.current
            ? BATCH
            : Math.min(BATCH, budgetRef.current);
          const links = await readLinksPendingTitleImage(Date.now(), take);
          if (links.length === 0) break;
          for (const link of links) {
            if (cancelled || !visibleRef.current) return;
            if (!activeRef.current && budgetRef.current <= 0) break;
            // Never throws — it records every outcome as a facet write.
            await runServerTitleImage(username, link, extractClient);
            if (!activeRef.current) budgetRef.current -= 1;
          }
          // Push this batch's `files/` + `extractions/` writes (and pull anything new);
          // the next iteration re-scans, where the just-settled links are excluded.
          requestSync();
        }
      } finally {
        runningRef.current = false;
        setIsRunning(false);
        if (rerunRef.current && !cancelled && visibleRef.current) {
          rerunRef.current = false;
          void drain();
        }
      }
    };

    void drain();
    return () => {
      cancelled = true;
    };
  }, [enabled, username, extractClient, hasWork, visible, isActive, requestSync]);

  const value = useMemo<ExtractionContextValue>(
    () => ({
      enabled,
      doneCount: counts.done,
      pendingCount: counts.pending,
      failedCount: counts.failed,
      isRunning,
      isActive,
      autoLimitReached,
      enrichAll,
      pause,
    }),
    [
      enabled,
      counts.done,
      counts.pending,
      counts.failed,
      isRunning,
      isActive,
      autoLimitReached,
      enrichAll,
      pause,
    ],
  );

  return <ExtractionContext.Provider value={value}>{children}</ExtractionContext.Provider>;
}

// Read extraction progress + drive the explicit "enrich all" / "pause" controls.
// Returns null-safe defaults outside a provider would hide a mounting bug, so it
// throws instead — mount <ExtractionProvider> above any consumer (the app layout does).
export function useExtraction(): ExtractionContextValue {
  const ctx = useContext(ExtractionContext);
  if (!ctx) throw new Error('useExtraction must be used within <ExtractionProvider>');
  return ctx;
}
