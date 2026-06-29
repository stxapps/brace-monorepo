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
//   2. Displayed-scoped auto drain. The automatic drain enriches only the pending
//      subset of the links the main pane is currently SHOWING (`reportDisplayedLinkPaths`
//      → `readLinksPendingTitleImageForLinkPaths`), so cost tracks ATTENTION: a 30k-link
//      bulk import never enriches past what the user scrolled into view. A
//      `AUTO_BUDGET`-per-session backstop still caps a user who deep-scrolls a huge
//      library in one sitting — past it the drain stops and flips `autoLimitReached`.
//   3. Explicit "enrich all". Draining the WHOLE library is a CONSCIOUS, user-driven
//      job: `enrichAll()` switches the source to the full-library scan
//      (`readLinksPendingTitleImage`) and lifts the auto cap (still visibility-gated),
//      `pause()` stops it. The bulk import is the opt-in moment the doc names —
//      surfaced via the context below (counts + controls) so the app can show "X of Y
//      enriched — [Enrich all] / [Pause]" rather than draining behind the user's back.
//
// The loop, gated on the opt-in + a ready store + visibility:
//   liveQuery(pending titleImage) wakes it → drain in paced batches, until the
//   backlog is empty, the auto budget is spent (auto mode), the tab hides, or the
//   user pauses. The SOURCE depends on mode: auto drains the displayed page's pending
//   subset; `enrichAll()` drains the whole library. Per link:
//     runServerTitleImage (extract → resize → write `files/` +
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

import {
  readExtractionFacetCounts,
  readLinksPendingTitleImage,
  readLinksPendingTitleImageForLinkPaths,
} from '../data/queries';
import { useSettings } from '../hooks/use-settings';
import { runServerTitleImage } from '../lib/server-extraction';
import { useAuth } from './auth-provider';
import { useSync } from './sync-provider';

// How many links one drain step processes before pushing and re-scanning. Small so
// the work is visibly incremental (each batch syncs, the list fills in) and naturally
// paced — `brace-extractor` is single-URL + IP-rate-limited, so we stay sequential
// within a batch rather than fanning out.
const BATCH = 5;

// The backstop ceiling: how many links the AUTOMATIC (displayed-scoped) drain processes
// per session before it stops and waits for an explicit `enrichAll()`. The displayed
// scope already bounds normal browsing to a page or three; this only catches a user who
// deep-scrolls a huge library in one sitting, so a bulk import can't auto-bill the server
// for thousands of requests even with the tab in front of them. Resets when the provider
// remounts — i.e. per fresh entry into the signed-in app (the provider sits above the
// initial-sync gate, so it survives that gate's loading/error/ready content swaps and is
// NOT torn down on a sync retry) — so a big library enriches a chunk per visit, or
// all-at-once when the user asks.
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
  // Report the link paths currently DISPLAYED in the main pane (the page the user is
  // browsing). The automatic drain enriches the pending subset of these — and only
  // these — so work tracks attention: an abandoned bulk import never enriches past
  // what was scrolled into view. Pass the page's link paths whenever they change; pass an
  // empty array when no links are shown. A no-op while extraction is disabled.
  reportDisplayedLinkPaths: (linkPaths: string[]) => void;
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

  // Remaining AUTOMATIC budget for this session — decremented per link in auto mode,
  // ignored in active mode. Held in a ref (not state) so spending it doesn't re-render.
  const budgetRef = useRef(AUTO_BUDGET);
  // User-initiated mode flag the loop reads live; mirrored to `isActive` state for the
  // UI and to re-trigger the drain effect (and the probe source) on toggle.
  const activeRef = useRef(false);
  const [isActive, setIsActive] = useState(false);
  const [autoLimitReached, setAutoLimitReached] = useState(false);

  // The link paths the main pane is currently showing, reported by the app via
  // `reportDisplayedLinkPaths`. The AUTOMATIC drain works only this set; `enrichAll()` ignores
  // it for the full-library scan. Mirrored to a ref so the running loop reads the latest
  // page mid-drain without the effect having to restart. Deduped on report so an
  // unchanged page keeps a stable reference (a stable liveQuery dep / no needless churn).
  const [displayedLinkPaths, setDisplayedLinkPaths] = useState<string[]>([]);
  const displayedLinkPathsRef = useRef(displayedLinkPaths);
  displayedLinkPathsRef.current = displayedLinkPaths;
  const reportDisplayedLinkPaths = useCallback((linkPaths: string[]) => {
    setDisplayedLinkPaths((prev) =>
      prev.length === linkPaths.length && prev.every((path, i) => path === linkPaths[i])
        ? prev
        : linkPaths,
    );
  }, []);

  // Cheap local wake signal: is there any titleImage pending AND ELIGIBLE right now
  // (respects backoff — unlike the display `pendingCount`, which excludes `failed`)?
  // The source matches the drain's: in `enrichAll` mode the whole library, otherwise just
  // the displayed page. liveQuery re-runs it whenever `db.items` changes — a fresh save,
  // an import, or a sync landing a cross-device link — and whenever the displayed page
  // changes (a scroll / "show more" / navigation), so the drain is reactive without a
  // fixed poll. Both reads are bounded (docs: "the local queue scan is free").
  const probe = useLiveQuery(() => {
    if (!enabled) return Promise.resolve([]);
    return isActive
      ? readLinksPendingTitleImage(Date.now(), 1)
      : readLinksPendingTitleImageForLinkPaths(displayedLinkPaths, Date.now());
  }, [enabled, isActive, displayedLinkPaths]);
  const hasWork = (probe?.length ?? 0) > 0;

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
          const take = activeRef.current ? BATCH : Math.min(BATCH, budgetRef.current);
          // Auto mode drains the displayed page's pending subset; enrichAll the whole
          // library. Both re-scan each batch, so just-settled links drop out next pass.
          const links = activeRef.current
            ? await readLinksPendingTitleImage(Date.now(), take)
            : (
                await readLinksPendingTitleImageForLinkPaths(
                  displayedLinkPathsRef.current,
                  Date.now(),
                )
              ).slice(0, take);
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
      reportDisplayedLinkPaths,
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
      reportDisplayedLinkPaths,
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
