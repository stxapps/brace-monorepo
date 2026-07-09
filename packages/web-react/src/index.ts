// Web-only React-logic layer: auth + sync providers, the local-first data layer
// (Dexie store, mutations, queries, projection, decode cache, pending/sync stores),
// the hand-rolled sync engine, and the editor/auth hooks. Shared by brace-web and
// brace-extension; the app provides the configured api client via @stxapps/react's
// ApiClientProvider (the seam these modules read through useApiClient / SyncDeps.api).
export * from './contexts/auth-provider';
export * from './contexts/extraction-provider';
export * from './contexts/lock-provider';
export * from './contexts/sync-provider';
export * from './data/clear-data';
export * from './data/db';
export * from './data/decode-cache';
export * from './data/local-settings-store';
export * from './data/lock-store';
export * from './data/mutations';
export * from './data/pending-store';
export * from './data/projection';
export * from './data/queries';
export * from './data/session-store';
export * from './data/subscription-store';
export * from './data/sync-store';
export * from './hooks/use-create-account';
export * from './hooks/use-entitlements';
export * from './hooks/use-link-mutations';
export * from './hooks/use-list-mutations';
export * from './hooks/use-lists';
export * from './hooks/use-pending-changes-count';
export * from './hooks/use-pin-mutations';
export * from './hooks/use-setting-mutations';
export * from './hooks/use-settings';
export * from './hooks/use-sign-in';
export * from './hooks/use-sign-out';
export * from './hooks/use-tag-mutations';
export * from './hooks/use-tags';
export * from './lib/auth-api-client';
export * from './lib/resize-image';
export * from './lib/server-extraction';
export * from './sync/crypto';
export * from './sync/engine';
export * from './sync/r2';
