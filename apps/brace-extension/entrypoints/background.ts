/**
 * Background service worker — the privileged core of the extension.
 *
 * MV3 service workers are EPHEMERAL (no long-running loop), so the recurring work
 * is driven by a `browser.alarms` tick rather than a timer:
 *   - on each alarm (and on startup) it runs a selective SYNC cycle
 *     (`runSync` → `runIncrementalSync`, materializing only links/ + extractions/).
 *   - it answers the typed popup → background message protocol, owning ALL
 *     privileged / CORS-exempt work: KICK_SYNC (run a cycle now), EXTRACT (capture a
 *     facet from the active tab + write back), GET_SYNC_STATUS (read the mirror).
 *
 * The popup never fetches brace-api or touches a tab directly — it sends a message
 * and renders the result.
 */

import { getSession, loadSession } from '@stxapps/web-react';

import { runExtraction } from '@/utils/extraction-worker';
import type { ExtensionMessage, MessageResponses } from '@/utils/messages';
import { readSyncStatus } from '@/utils/messages';
import { runSync } from '@/utils/sync-runner';

const SYNC_ALARM = 'brace-sync';
// MV3 caps alarm frequency at ~1/min; one minute is the tightest useful cadence.
const SYNC_PERIOD_MINUTES = 1;

export default defineBackground(() => {
  // Periodic sync. `create` with the same name is idempotent across worker restarts.
  browser.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MINUTES });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) void runSync();
  });
  // Kick one cycle as the worker spins up (on install / browser start / wake).
  void runSync();

  browser.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    handle(message).then(sendResponse, (err: unknown) =>
      sendResponse({ ok: false, error: errorMessage(err) }),
    );
    // Keep the channel open for the async response.
    return true;
  });
});

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
