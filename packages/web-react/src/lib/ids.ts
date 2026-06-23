// ID helpers. Uses the Web Crypto API (`crypto.*`), a global in the browser —
// no imports needed. Mirrors apps/brace-api/src/lib/ids.ts so both apps mint ids
// the same way; kept app-local (not in @stxapps/shared) because shared is
// platform:agnostic and deliberately avoids runtime crypto globals.

// A random, collision-resistant id for new entities (lists, links, tags). UUID
// v4 is plenty for client-minted ids; we don't need sortable/k-ordered ids.
export function newId(): string {
  return crypto.randomUUID();
}
