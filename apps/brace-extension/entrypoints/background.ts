/**
 * Background service worker — the privileged core of the extension.
 *
 * MV3 service workers are EPHEMERAL (no long-running loop), so the recurring work
 * is driven by a `browser.alarms` tick rather than a timer:
 *   - on each alarm (and on startup) it runs SYNC → BACKGROUND EXTRACTION → SYNC
 *     (`syncExtractSync`): a selective sync cycle (materializing only links/ +
 *     extractions/), then drains the residual title+image queue at bg-fetch tier
 *     (`runBackgroundExtraction` — raw-HTML fetch, no open tab), then pushes the
 *     freshly written `extractions/`/`files/` back up.
 *   - it answers the typed popup → background message protocol, owning ALL
 *     privileged / CORS-exempt work: KICK_SYNC (run a cycle now), EXTRACT (capture a
 *     facet from the active tab + write back), GET_SYNC_STATUS (read the mirror).
 *
 * The popup never fetches brace-api or touches a tab directly — it sends a message
 * and renders the result.
 */

import { getSession, loadSession } from '@stxapps/web-react';

import { runBackgroundExtraction, runExtraction } from '@/utils/extraction-worker';
import type { ExtensionMessage, MessageResponses } from '@/utils/messages';
import { readSyncStatus } from '@/utils/messages';
import { runSync } from '@/utils/sync-runner';

const SYNC_ALARM = 'brace-sync';
// The alarm drives the NETWORK SYNC POLL (`ops/list`, to discover other devices'
// changes) plus the BACKGROUND EXTRACTION sweep that follows it. Nothing is on the
// critical path here (the saving client already extracted; this only drains the residual
// — cross-device pickups and imports), so this is the idle CEILING the doc prescribes —
// ~1h, not a fast tick that spends a request a minute to almost always find nothing.
// Freshness rides cheap local wake triggers instead (worker startup below, KICK_SYNC
// from the popup, post-EXTRACT sync). See docs/link-extraction.md "the queue is a query".
const SYNC_PERIOD_MINUTES = 60;

export default defineBackground(() => {
  // Periodic sync + extraction. `create` with the same name is idempotent across restarts.
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void syncExtractSync();
  });
  // Kick one cycle as the worker spins up (on install / browser start / wake).
  void syncExtractSync();

  browser.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    handle(message).then(sendResponse, (err: unknown) =>
      sendResponse({ ok: false, error: errorMessage(err) }),
    );
    // Keep the channel open for the async response.
    return true;
  });
});

// The periodic cycle: SYNC (pull other devices' new links/extractions) → EXTRACT
// (drain the residual title+image queue at bg-fetch tier — see runBackgroundExtraction)
// → SYNC (push what we just wrote). The trailing sync is skipped when the sweep wrote
// nothing (the steady state — every save's own client already extracted it), so an idle
// tick costs exactly one `ops/list`. Signed out, the first sync presents an idle store
// and there's no username to extract under.
async function syncExtractSync(): Promise<void> {
  await runSync();
  const username = await currentUsername();
  if (!username) return;
  const written = await runBackgroundExtraction(username);
  if (written > 0) await runSync();
}

async function handle(
  message: ExtensionMessage,
): Promise<MessageResponses[ExtensionMessage['type']]> {
  switch (message.type) {
    case 'KICK_SYNC':
      await runSync();
      return { ok: true };

    case 'EXTRACT': {
      const username = await currentUsername();
      if (!username) return { ok: false, error: 'Not signed in' };
      await runExtraction(username, message.linkId, message.facet);
      // Push the freshly written files/links to the server (and pull anything new).
      void runSync();
      return { ok: true };
    }

    case 'GET_SYNC_STATUS':
      return readSyncStatus();
  }
}

async function currentUsername(): Promise<string | null> {
  const session = (await loadSession()) ?? getSession();
  return session?.username ?? null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
