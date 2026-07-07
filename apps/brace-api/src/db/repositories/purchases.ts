import type { Plan, SubscriptionSource } from '@stxapps/shared';

// Purchase repository — subscription rows in DIRECTORY_DB (global, NOT an
// account shard: webhook events arrive keyed by the provider's subscription id,
// so the lookup must be un-sharded — see the schema note in
// db/schemas/directory.sql). Statuses are already NORMALIZED here (the webhook
// edge maps provider vocab before writing), so the fold in services/iap.ts
// never sees provider-specific states.

// Normalized subscription lifecycle states, a superset small enough for every
// provider to map onto: Paddle uses these words natively; the App Store /
// Play Store verifiers map their state enums onto them later.
export const PURCHASE_STATUSES = ['active', 'trialing', 'past_due', 'paused', 'canceled'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

// Public domain entity (camelCase).
export type PurchaseEntity = {
  id: string;
  userId: string;
  source: SubscriptionSource;
  externalId: string;
  plan: Exclude<Plan, 'free'>;
  status: PurchaseStatus;
  providerCustomerId: string | null;
  expiresAt: number | null; // epoch ms; null = non-expiring (manual/lifetime)
  canceledAt: number | null;
};

// Raw row as it sits in D1 (snake_case columns). Internal to this repo.
type PurchaseRow = {
  id: string;
  user_id: string;
  source: string;
  external_id: string;
  plan: string;
  status: string;
  provider_customer_id: string | null;
  expires_at: number | null;
  canceled_at: number | null;
};

const SELECT_COLUMNS = `id, user_id, source, external_id, plan, status,
       provider_customer_id, expires_at, canceled_at`;

function toEntity(r: PurchaseRow): PurchaseEntity {
  return {
    id: r.id,
    userId: r.user_id,
    source: r.source as SubscriptionSource,
    externalId: r.external_id,
    plan: r.plan as Exclude<Plan, 'free'>,
    status: r.status as PurchaseStatus,
    providerCustomerId: r.provider_customer_id,
    expiresAt: r.expires_at,
    canceledAt: r.canceled_at,
  };
}

export function purchasesRepo(db: D1Database) {
  return {
    // Everything ever purchased by this user — the fold's input (a handful of
    // rows at most; the fold picks the entitled one, so no WHERE on status here).
    async listByUserId(userId: string): Promise<PurchaseEntity[]> {
      const { results } = await db
        .prepare(`SELECT ${SELECT_COLUMNS} FROM purchases WHERE user_id = ?`)
        .bind(userId)
        .all<PurchaseRow>();
      return results.map(toEntity);
    },

    // The webhook's write: one idempotent, out-of-order-safe upsert keyed by the
    // provider's subscription identity. Three guards live in the SQL itself:
    //  - `ON CONFLICT ... WHERE excluded.event_occurred_at >= event_occurred_at`
    //    drops a STALE event (Paddle retries + redeliveries arrive unordered);
    //  - `user_id` is deliberately NOT in the update set — first sight of a
    //    subscription binds it to an account for life, so a crafted later event
    //    can't re-point someone else's subscription at the attacker's account;
    //  - `expires_at = COALESCE(excluded…, purchases…)` keeps the last known
    //    period end when an event (e.g. an immediate cancel) omits it, while
    //    `canceled_at` IS overwritten as sent — null must be able to CLEAR it
    //    (the user resumed a scheduled cancellation).
    async upsertFromProvider(p: {
      id: string; // used only on INSERT (a fresh newId()); conflicts keep the stored id
      userId: string;
      source: SubscriptionSource;
      externalId: string;
      plan: Exclude<Plan, 'free'>;
      status: PurchaseStatus;
      providerCustomerId: string | null;
      expiresAt: number | null;
      canceledAt: number | null;
      eventOccurredAt: number;
    }): Promise<void> {
      const now = Date.now();
      await db
        .prepare(
          `INSERT INTO purchases (
             id, user_id, source, external_id, plan, status,
             provider_customer_id, expires_at, canceled_at,
             event_occurred_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (source, external_id) DO UPDATE SET
             plan                 = excluded.plan,
             status               = excluded.status,
             provider_customer_id = COALESCE(excluded.provider_customer_id, provider_customer_id),
             expires_at           = COALESCE(excluded.expires_at, expires_at),
             canceled_at          = excluded.canceled_at,
             event_occurred_at    = excluded.event_occurred_at,
             updated_at           = excluded.updated_at
           WHERE excluded.event_occurred_at >= event_occurred_at`,
        )
        .bind(
          p.id,
          p.userId,
          p.source,
          p.externalId,
          p.plan,
          p.status,
          p.providerCustomerId,
          p.expiresAt,
          p.canceledAt,
          p.eventOccurredAt,
          now,
          now,
        )
        .run();
    },

    // The account a subscription is already bound to (or null when unseen) —
    // read by the webhook to keep `user_id` first-write-wins even when a later
    // event carries a different custom_data.userId.
    async findBySourceExternalId(
      source: SubscriptionSource,
      externalId: string,
    ): Promise<PurchaseEntity | null> {
      const row = await db
        .prepare(`SELECT ${SELECT_COLUMNS} FROM purchases WHERE source = ? AND external_id = ?`)
        .bind(source, externalId)
        .first<PurchaseRow>();
      return row ? toEntity(row) : null;
    },
  };
}
