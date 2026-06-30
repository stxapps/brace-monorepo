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
// free (all just rows the same pending-titleImage queries return), and keeps
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
//      (`readLinksPendingTitleImagePage`, cursor-paginated newest-first) and lifts the
//      auto cap (still visibility-gated), `pause()` stops it. The bulk import is the opt-in moment the doc names —
//      surfaced via the context below (counts + controls) so the app can show "X of Y
//      enriched — [Enrich all] / [Pause]" rather than draining behind the user's back.
//
// The loop, gated on the opt-in + a ready store + visibility:
//   a wake signal kicks it → drain in paced batches, until the backlog is empty, the
//   auto budget is spent (auto mode), the tab hides, or the user pauses. The SOURCE
//   depends on mode: auto re-scans the displayed page's pending subset each batch;
//   `enrichAll()` pages the whole library newest-first via a forward cursor (no top
//   re-scan). Per batch:
//     runServerTitleImageBatch (one extract — server fans out — → titles first, then
//     images pooled → write `files/` + `extractions/`) → requestSync() to push →
//     next page / re-scan → repeat.
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

import { useExtractClient } from '@stxapps/react';
import { MAX_EXTRACT_URLS } from '@stxapps/shared';

import {
  type LinkScanCursor,
  readExtractionFacetCounts,
  readLinksPendingTitleImageForLinkPaths,
  readLinksPendingTitleImagePage,
} from '../data/queries';
import { useSettings } from '../hooks/use-settings';
import { runServerTitleImageBatch } from '../lib/server-extraction';
import { useAuth } from './auth-provider';
import { useSync } from './sync-provider';

// How many links one drain step processes before pushing and re-scanning. One step is a
// SINGLE batched `extract` request — the server fans the URLs out concurrently — so we
// take the contract's full per-request cap (`MAX_EXTRACT_URLS`): a page's titles land
// together in ~one round trip instead of trickling one-by-one. Each step still re-scans
// and syncs, so the list keeps filling in incrementally, just a page at a time. The cap
// also bounds how much a visibility-hide can over-commit (a step doesn't check mid-batch).
const BATCH = MAX_EXTRACT_URLS;

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

export function ExtractionProvider({ children }: { children: ReactNode }) {
  // The app's env-bound `brace-extractor` client, or null when no extractor origin is
  // configured — in which case the loop is permanently inert (server extraction off).
  // Read from the ExtractClientProvider seam rather than a prop: it's a function-bearing
  // object, so passing it from the Server-Component app layout would fail to serialize
  // across the server→client boundary (mirrors how SyncProvider gets `api` via useApiClient).
  const extractClient = useExtractClient();
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

  // Resume point for the whole-library enrich-all walk (active mode). Held in a ref so the
  // drain advances it across batches without re-scanning from the top — the property that
  // keeps enrich-all O(library), not O(library²). `undefined` = start at the newest link;
  // `enrichAll()` resets it, and the drain resets it again on reaching the end so a later
  // wake (e.g. a sync landing new links) re-scans from the newest.
  const activeCursorRef = useRef<LinkScanCursor | undefined>(undefined);

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

  // Cheap local wake signal for the AUTO (displayed-scoped) drain: is any titleImage on the
  // currently-shown page pending AND ELIGIBLE right now (respects backoff — unlike the
  // display `pendingCount`, which excludes `failed`)? liveQuery re-runs it whenever
  // `db.items` changes — a fresh save, an import, or a sync landing a cross-device link —
  // and whenever the displayed page changes (a scroll / "show more" / navigation), so the
  // drain is reactive without a fixed poll. Bounded to O(displayed). Inert in active mode,
  // where the wake comes from `counts.pending` below instead (no per-write library scan).
  const probe = useLiveQuery(() => {
    if (!enabled || isActive) return Promise.resolve([] as unknown[]);
    return readLinksPendingTitleImageForLinkPaths(displayedLinkPaths, Date.now());
  }, [enabled, isActive, displayedLinkPaths]);
  // Active (enrich-all) mode wakes off the free index-count `counts.pending` (not-yet-attempted
  // links) rather than a per-write whole-library eligibility scan: pending > 0 always means
  // genuine eligible work (an absent facet is always eligible), and any cooled-`failed` links
  // the walk passes are still retried inline. When pending hits 0 the drain idles; a fresh
  // import or synced link lifts it again. Auto mode uses the displayed-scoped probe.
  const hasWork = isActive ? counts.pending > 0 : (probe?.length ?? 0) > 0;

  // Single-flight the drain: a wake while one is running sets `rerun` so it loops once
  // more at the end, instead of overlapping.
  const runningRef = useRef(false);
  const rerunRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);

  const enrichAll = useCallback(() => {
    activeRef.current = true;
    activeCursorRef.current = undefined; // walk the whole library from the newest link
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

          if (activeRef.current) {
            // Active (enrichAll): page the WHOLE library newest-first via a forward cursor —
            // each batch resumes where the last left off (no top re-scan, no blocked-set
            // rebuild), so the drain is O(library), not O(library²). A non-null cursor always
            // pairs with a full page; a null cursor means we hit the oldest link.
            const page = await readLinksPendingTitleImagePage(
              Date.now(),
              BATCH,
              activeCursorRef.current,
            );
            if (page.links.length > 0) {
              // One batched extract enriches the whole page — the server fans the URLs out,
              // so titles land together fast and images fill in pooled. Never throws.
              await runServerTitleImageBatch(username, page.links, extractClient);
              // Push this batch's `files/` + `extractions/` writes (and pull anything new).
              requestSync();
            }
            if (page.cursor === null) {
              // End of library reached. Reset so a later wake (a sync landing new links)
              // re-scans from the newest rather than resuming past the end.
              activeCursorRef.current = undefined;
              break;
            }
            activeCursorRef.current = page.cursor;
            continue;
          }

          // Auto mode: drain the displayed page's pending subset, capped by the session budget.
          if (budgetRef.current <= 0) {
            setAutoLimitReached(true);
            break;
          }
          const take = Math.min(BATCH, budgetRef.current);
          const links = (
            await readLinksPendingTitleImageForLinkPaths(displayedLinkPathsRef.current, Date.now())
          ).slice(0, take);
          if (links.length === 0) break;
          // Returns the count processed (`take` already bounds it to the auto budget).
          const processed = await runServerTitleImageBatch(username, links, extractClient);
          budgetRef.current -= processed;
          // Push writes; the next iteration re-scans, where just-settled links drop out.
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
