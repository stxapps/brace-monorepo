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
// enforce anything COUNTABLE blind (total bytes, object counts, the `links/`
// count), while per-feature gates (read-mode, screenshot, the page-copy meter)
// are client-enforced UX backed by the blob rules. What the server CANNOT do is
// tell one `files/` blob from another: a preview image, a screenshot, and a page
// copy are all opaque `files/{id}.enc` under the same namespace, so there is no
// server-visible signal to allow the free preview image while denying a heavy
// blob. The free tier therefore stores `files/` blobs (client-extracted preview
// images — see docs/business-model.md "tiers"), bounded server-hard only by the
// byte/count backstop (maxBytes, maxFiles) and the 200-link cap; the heavy-blob
// distinction is client-enforced. That matches the business model on purpose:
// the hard walls sit exactly where a blind server CAN count the cost, and a
// client-side bypass can only ever unlock features that cost ~nothing to serve.
//
// So the entitlements below split into two kinds of gate (see the same split in
// docs/business-model.md "tiers"):
//   - COST-DEFENSIVE (maxLinks, maxPageCopies, maxFiles, maxBytes,
//     serverExtraction) — protect real cost / the moat; server-hard where
//     countable.
//   - VALUE-CAPTURE (locks, nestedLists, searchEditor, smartLists,
//     savedSearches, aiTier) — pure willingness-to-pay for things that cost
//     ~nothing to serve; all client-enforced. Their spine: Plus unlocks
//     STRUCTURAL organization (nested lists today, plus the tag-hierarchy +
//     per-list-link-order levers the doc plans — see the DOC-AHEAD-OF-CODE note
//     below) + the structured search editor + privacy; Pro unlocks AUTOMATED /
//     dynamic organization + intelligence (it arranges itself).
// What is deliberately NOT an entitlement stays free for everyone: theme, FLAT
// tags, flat lists, pin, sort options, MANUAL reorder of list/tag SIBLINGS (and
// of pinned links), multi-select move/tag/delete, and full data export — habit-
// loop, table-stakes, or anti-lock-in, so never gated. Sibling/tree/pin order is
// free across the board: at the free tier's scale (≤200 links, a handful of
// lists/tags) hand-arranging is a cheap habit-loop nicety with ~no willingness-
// to-pay, and pins already give free hand-ordering of links.
//
// DOC-AHEAD-OF-CODE: docs/business-model.md's tiers table lists two more Plus
// value-capture levers that are NOT yet entitlement fields here, because the
// product decision is still open (they ship on user feedback, not at launch):
//   - tag HIERARCHY (nested tags) — the tag analog of nestedLists; only DEPTH is
//     the lever, FLAT tags stay free (above).
//   - per-list manual LINK ordering — a hand-curated sequence WITHIN a list
//     (distinct from the free sibling/tree order); Plus-worthy only because it
//     pays off past the free tier's link ceiling.
// When either ships, add a `tagHierarchy` / `linkOrdering` boolean below
// (free:false, plus:true, pro:true — mirroring nestedLists) and the table and
// the data reconverge.

export const PLANS = ['free', 'plus', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

// Paid plans, lowest first — the full paid CATALOG. `PLANS` minus 'free'.
export const PAID_PLANS = ['plus', 'pro'] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];

// The paid plans actually ON SALE right now — the launch subset the checkout
// contract (iap/endpoints.ts) and the upgrade cards enumerate. Pro is fully
// specified in this file (its entitlements, price, and the server's Paddle price
// branch are all the spec-in-waiting) but not yet SOLD: it goes on sale once the
// automated-organization features (smartLists / savedSearches) exist to back it.
// Putting Pro on sale is then a ONE-LINE change here — add 'pro' — and nothing
// else about the plan moves. Kept separate from PAID_PLANS (the full catalog) so
// `entitlementsOf('pro')`, PLAN_USD_PER_YEAR['pro'], manual 'pro' grants, and
// docs/business-model.md all stay valid while Pro is off the storefront.
export const AVAILABLE_PAID_PLANS = ['plus'] as const;
export type AvailablePaidPlan = (typeof AVAILABLE_PAID_PLANS)[number];

export type AiTier = 'none' | 'basic' | 'full';

// What a plan unlocks. `null` on a numeric limit means unlimited.
export type Entitlements = {
  // Max `links/` entries (the free-tier keystone: 200 links is a serious trial
  // but past "free forever"). Server-hard: brace-api counts `links/` paths in
  // the user's size map at `files/sign`. `null` on paid plans.
  maxLinks: number | null;
  // Saved-page-copy meter (Plus keeps the last 50; Pro unlimited) — the count of
  // `pageCopy` extraction blobs, NOT a cap on how many links may sit in the
  // Archive system list (an unrelated concept that used to share the word). CLIENT-
  // enforced only: a page copy is indistinguishable from any other `files/` blob
  // server-side; the byte quota is the backstop.
  maxPageCopies: number | null;
  // Hard object-count cap — an abuse bound, not a product lever (see the byte
  // ceiling for what actually bites). Generous on paid plans: ~5 000 bookmarks
  // at 2-3 files each stays well under it.
  maxFiles: number;
  // Total stored bytes (the storage quota row in the tiers table). The real
  // server-hard wall on EVERY plan — including free, where it (with maxFiles and
  // the 200-link cap) is the only backstop on preview-image blob storage now
  // that free stores `files/` blobs. A maxed 200-link free library of client-
  // extracted preview images is ~16 MB, well under the free ceiling.
  maxBytes: number;
  // Whether the account MAY opt in to `brace-extractor` (the separate synced
  // `serverExtraction` preference in settingsGeneralSchema is the user's opt-in;
  // this is the plan gate over it).
  serverExtraction: boolean;

  // --- Value-capture gates (all CLIENT-enforced) --------------------------
  // Pure willingness-to-pay; a client-side bypass only ever unlocks a
  // convenience that costs ~nothing to serve (same acceptable-risk logic as the
  // page-copy meter above).

  // Nested lists/folders (Plus+) — the "manual organization" Plus lever, gating
  // a STRUCTURAL capability (depth/reparenting), not cosmetic order. Free stays
  // fully usable on flat lists + tags; paid organizes deeper — never
  // "un-crippled." (Manual sibling ORDER — drag / up-down / pin order — is NOT
  // gated; see the header note on why manual ordering is free across the board.)
  nestedLists: boolean;
  // App lock + per-list hide — the privacy-wedge lever (Plus+). E2E encryption
  // stays FREE for everyone; this is the convenience layer over it (biometric
  // quick-lock, hide-a-list), not the security substrate, so gating it is not
  // gating privacy.
  locks: boolean;
  // Structured search editor (Plus+) — the middle rung of the search ladder.
  // Free already gets real word search across the WHOLE library (title / url /
  // host); that basic rung is NOT gated (gating it would cripple a daily-loop
  // basic). This gates only the EDITOR: field-scoped (url vs title), multi-list
  // / multi-tag, boolean queries. Client-side, so it costs ~nothing to serve,
  // and it couples to unlimited links the same way per-list ordering does. Pro
  // then persists these queries as `savedSearches` — Basic → structure-by-hand
  // → automated mirrors the Free → Plus → Pro spine.
  searchEditor: boolean;
  // Smart lists & smart tags (Pro) — the "it organizes itself" half of the Pro
  // story. A saved RULE that auto-POPULATES from metadata the user already set
  // (domain, existing tags, dates): a smart list is a query promoted to the
  // lists tree, a smart tag is a virtual/computed tag whose membership is a
  // rule. Deterministic, runs on the client's local decrypted store (no server,
  // no plaintext leak) — which is why it needs NO AI: buildable whenever, not
  // blocked on on-device-model quality (a readiness point, not a ship date — Pro
  // is SEQUENCED after the Free+Plus launch, built once the app is stable, not
  // live now). Explicitly NOT AI auto-
  // tagging: it never WRITES `listId`/`tagIds` onto a link, and it infers
  // nothing from page CONTENT. Auto-choosing a list / auto-adding tags from
  // content is `aiTier` (parked) — kept a separate entitlement on purpose so
  // the two never get conflated.
  smartLists: boolean;
  // Saved searches (Pro) — same predicate-over-local-store engine as smartLists,
  // just surfaced in the search UI (an ad-hoc query, remembered) rather than
  // promoted into the lists/tags taxonomy. Same automated-org spine.
  savedSearches: boolean;
  // On-device AI — the future Pro lever (auto-tag/keywords → summaries/semantic
  // search). Client-enforced (runs on-device). PARKED for now: on-device models
  // aren't good enough yet, so every plan ships `'none'` and AI is marketed as
  // "coming." When it lands it belongs wholly to Pro (all intelligence lives in
  // Pro); Plus is already carried by locks + nested lists.
  aiTier: AiTier;
};

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

// The tiers table from docs/business-model.md, as data — minus the two DOC-
// AHEAD-OF-CODE rows noted in the header (tag hierarchy, per-list link order),
// planned Plus levers not yet gated. Numbers are planning values — tune here and
// both edges follow.
const ENTITLEMENTS: Record<Plan, Entitlements> = {
  free: {
    maxLinks: 200,
    maxPageCopies: 0,
    // A maxed 200-link library of client-extracted preview images is ~16 MB;
    // maxFiles here is a pure abuse backstop (links + preview-image blobs +
    // lists/tags/pins/extractions ride along, never legitimately near this).
    maxFiles: 5_000,
    maxBytes: 100 * MIB,
    serverExtraction: false,
    nestedLists: false,
    locks: false,
    searchEditor: false,
    smartLists: false,
    savedSearches: false,
    aiTier: 'none',
  },
  plus: {
    maxLinks: null,
    maxPageCopies: 50,
    maxFiles: 200_000,
    maxBytes: 5 * GIB,
    serverExtraction: true,
    // Plus = structural organization.
    nestedLists: true,
    locks: true,
    searchEditor: true,
    smartLists: false,
    savedSearches: false,
    aiTier: 'none',
  },
  pro: {
    maxLinks: null,
    maxPageCopies: null,
    maxFiles: 200_000,
    maxBytes: 20 * GIB,
    serverExtraction: true,
    nestedLists: true,
    locks: true,
    searchEditor: true,
    // Pro = automated / dynamic organization + intelligence (it arranges itself).
    smartLists: true,
    savedSearches: true,
    // Set to 'full' once on-device AI ships; parked at 'none' for now.
    aiTier: 'none',
  },
};

export function entitlementsOf(plan: Plan): Entitlements {
  return ENTITLEMENTS['plus'];
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
