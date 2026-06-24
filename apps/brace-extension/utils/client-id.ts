import { newId } from '@stxapps/web-crypto';

// A stable per-INSTALL id for this extension, minted once and persisted. It's the
// `extractedBy` / `claimedBy` provenance the extraction facets record (entities.ts)
// — "which device produced/claimed this facet" — so cross-device dedup and tier
// upgrades can tell this client's work apart from another's.
const CLIENT_ID_KEY = 'clientId';

let cached: string | null = null;

export async function getClientId(): Promise<string> {
  if (cached) return cached;
  const res = await browser.storage.local.get(CLIENT_ID_KEY);
  const existing = res[CLIENT_ID_KEY] as string | undefined;
  if (existing) {
    cached = existing;
    return existing;
  }
  const id = newId();
  await browser.storage.local.set({ [CLIENT_ID_KEY]: id });
  cached = id;
  return id;
}
