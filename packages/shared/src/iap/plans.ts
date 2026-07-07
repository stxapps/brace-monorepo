// The subscription plans and what each one entitles — the single source of truth
// both edges read (see docs/business-model.md "tiers"): the CLIENT paywall UI
// derives feature gates and upsell copy from `entitlementsOf(plan)`, and the
// SERVER quota gate (brace-api lib/quota.ts, applied at `files/sign`) enforces
// the same numbers. Defining the limits once here is the same move as
// LINK_TITLE_MAX in sync/entities.ts: the place that enforces a limit and the
// place that displays it can never drift apart.
//
// What's enforceable where is deliberately asymmetric (the E2E trust model):
// content is opaque to the server, but PATHS are not — so the server can hard-
// enforce anything countable blind (total bytes, object counts, the `links/` /
// `files/` namespaces), while per-feature gates (read-mode, screenshot, the
// archive meter) are client-enforced UX backed by the blob rules. That matches
// the business model on purpose: the hard walls sit exactly where the cost is
// (blob storage), and a client-side bypass can only ever unlock features that
// cost ~nothing to serve.

export const PLANS = ['free', 'plus', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

// Paid plans, lowest first — what the upgrade UI enumerates. `PLANS` minus 'free'.
export const PAID_PLANS = ['plus', 'pro'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

export type AiTier = 'none' | 'basic' | 'full';

// What a plan unlocks. `null` on a numeric limit means unlimited.
export type Entitlements = {
  // Max `links/` entries (the free-tier keystone: 200 links is a serious trial
  // but past "free forever"). Server-hard: brace-api counts `links/` paths in
  // the user's size map at `files/sign`. `null` on paid plans.
  maxLinks: number | null;
  // Whether the plan may store `files/` blobs AT ALL (preview images, read-mode
  // content, screenshots, archives — every heavy blob rides this namespace).
  // Server-hard: free-tier `files/` puts are rejected at `files/sign`. This one
  // gate is what makes the free tier metadata-only.
  blobFiles: boolean;
  // Full-page-archive meter (Plus keeps the last 50; Pro unlimited). CLIENT-
  // enforced only: an archive is indistinguishable from any other `files/` blob
  // server-side; the byte quota is the backstop.
  maxArchivedLinks: number | null;
  // Hard object-count cap — an abuse bound, not a product lever (see the byte
  // ceiling for what actually bites). Generous on paid plans: ~5 000 bookmarks
  // at 2-3 files each stays well under it.
  maxFiles: number;
  // Total stored bytes (the storage quota row in the tiers table). The real
  // server-hard wall for paid plans; on free it's a backstop only, since
  // metadata-only usage is ~2 KB/link.
  maxBytes: number;
  // Whether the account MAY opt in to `brace-extractor` (the separate synced
  // `serverExtraction` preference in settingsGeneralSchema is the user's opt-in;
  // this is the plan gate over it).
  serverExtraction: boolean;
  // On-device AI level — the Plus→Pro lever (basic auto-tag/keywords vs full
  // summaries/semantic search). Client-enforced (it runs on-device).
  aiTier: AiTier;
};

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

// The tiers table from docs/business-model.md, as data. Numbers are planning
// values — tune here and both edges follow.
const ENTITLEMENTS: Record<Plan, Entitlements> = {
  free: {
    maxLinks: 200,
    blobFiles: false,
    maxArchivedLinks: 0,
    // 200 links at ~2 KB metadata is ~400 KB; these are pure abuse backstops
    // (lists/tags/pins/extractions ride along, never legitimately near this).
    maxFiles: 5_000,
    maxBytes: 100 * MIB,
    serverExtraction: false,
    aiTier: 'none',
  },
  plus: {
    maxLinks: null,
    blobFiles: true,
    maxArchivedLinks: 50,
    maxFiles: 200_000,
    maxBytes: 5 * GIB,
    serverExtraction: true,
    aiTier: 'basic',
  },
  pro: {
    maxLinks: null,
    blobFiles: true,
    maxArchivedLinks: null,
    maxFiles: 200_000,
    maxBytes: 20 * GIB,
    serverExtraction: true,
    aiTier: 'full',
  },
};

export function entitlementsOf(plan: Plan): Entitlements {
  return ENTITLEMENTS[plan];
}

// Display metadata for the plan cards. The PRICES here are the planned list
// prices for copy only ("$24/yr") — the authoritative, localized,
// tax-inclusive price is whatever the Paddle checkout (or the store sheet)
// shows; these must match the catalog configured there.
export const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  plus: 'Plus',
  pro: 'Pro',
};

export const PLAN_USD_PER_YEAR: Record<PaidPlan, number> = {
  plus: 24,
  pro: 48,
};
