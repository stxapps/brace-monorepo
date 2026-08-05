import type { Metadata } from 'next';

import {
  AVAILABLE_PAID_PLANS,
  entitlementsOf,
  LIFETIME_ON_SALE,
  LIFETIME_PLAN,
  LIFETIME_SEATS,
  LIFETIME_USD,
  type Plan,
  PLAN_CARDS,
  PLAN_LABELS,
  PLAN_USD_PER_YEAR,
  TRIAL_DAYS,
} from '@stxapps/shared';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { cn } from '@stxapps/web-ui/lib/utils';

import { CREATE_ACCOUNT_URL, SUPPORT_EMAIL, UPGRADE_URL } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Pricing',
  // Derived like everything else on the page: a search snippet that promises a
  // cap or a trial length the product doesn't have is the same drift, just
  // harder to notice because nobody reads it in review.
  description: `Bracemark is free for your first ${entitlementsOf('free').maxLinks} links. Plus adds unlimited links, app lock and hidden lists, and the search editor — with a ${TRIAL_DAYS}-day free trial.`,
};

// The public pricing page. Every NUMBER on it — the prices, the link caps, the
// trial length — and the paid tiers' feature copy are read from `iap/plans.ts`
// in @stxapps/shared, never retyped here: "a marketing pricing page that
// hand-copies quotas is the classic drift" (docs/architecture.md, _apps_), and
// that file is the same source the paywall UI and the server quota gate read.
//
// The one entitlement deliberately NOT published: the byte/file storage quota
// (`maxBytes` / `maxFiles`). It is a server-hard cost backstop, not a product
// gate, and until the heavy-blob features ship (read-mode, screenshot, page
// copy — all ▹ planned) nothing can reach it: the only blob a library stores is
// the client-extracted preview image, so a maxed 200-link free account is ~16 MB
// against 100 MiB. Publishing a limit for a feature that does not exist yet is
// the inverse of the never-promise-what-isn't-built rule, invites the
// Drive/Dropbox comparison on an axis Bracemark doesn't compete on, and turns a
// number we still need to retune into a contract we'd have to grandfather. Put
// the row back when the heavy blobs land and the number is finally load-bearing.
// A user who somehow reaches the ceiling still gets told, in-app, by the "storage
// full" surfaces the quota gate already drives. Argued in
// docs/business-model.md, _the storage quota is not published_.
//
// Which plans appear is likewise data, in both directions: the cards and the
// comparison COLUMNS are `AVAILABLE_PAID_PLANS`, so putting Pro on sale stays the
// one-line change in plans.ts, and the gated comparison ROWS call
// `entitlementsOf(plan)` rather than restating the tiers table — a new column
// fills itself in. `LIFETIME_ON_SALE` gates the lifetime offer the same way.
//
// What is site-owned copy, and why: the FREE card's feature list, the
// non-entitlement comparison rows (encryption, sync, export — true on every plan,
// so there is nothing to derive them from), and the FAQ. plans.ts holds card copy
// for the PAID plans only, since both storefronts render upgrade cards and never
// a free one. Keep those in step with docs/business-model.md by hand; every
// number a buyer could be misled by still comes from the data.
//
// TODO before launch: the launch-lever copy ("early supporters keep this price"),
// and the monthly cadence if `AVAILABLE_CADENCES` grows — a cadence toggle, not a
// second card, since monthly is the same entitlement billed differently.

// A single inline glyph instead of lucide-react: the marketing site's dependency
// budget is `shared` + `web-ui` and nothing else (docs/architecture.md, _apps_),
// and one check mark doesn't earn a package on the apex.
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 10.5 8 14.5 16 5.5" />
    </svg>
  );
}

function formatLinks(plan: Plan): string {
  const { maxLinks } = entitlementsOf(plan);
  return maxLinks === null ? 'Unlimited' : `${maxLinks}`;
}

// The one line of hard limits under each card, straight from the entitlements
// table — the number a buyer would otherwise have to take on faith. Links are
// the whole line on purpose: the storage quota is unpublished (see the header),
// and the link cap is the only limit that actually binds a library today.
function limitsLine(plan: Plan): string {
  return entitlementsOf(plan).maxLinks === null ? 'Unlimited links' : `${formatLinks(plan)} links`;
}

// $48/yr shown the way the buyer evaluates it. Derived from the same number, so
// it can never disagree with the sticker price or with the Paddle catalog.
function monthlyEquivalent(usdPerYear: number): string {
  const perMonth = usdPerYear / 12;
  return Number.isInteger(perMonth) ? `$${perMonth}` : `$${perMonth.toFixed(2)}`;
}

// Only what SHIPS — the same rule the paid card copy in plans.ts follows. Read
// mode, screenshots, page copies and AI are entitlements without features behind
// them yet, so they are not promised anywhere on this page.
//
// The previews line names WHERE it happens on purpose. Free gets the best
// extractor there is — the browser extension's active tab, or the mobile app's
// native fetch — but only for a link that device saves, so a free web-only
// visitor gets no previews at all (docs/link-extraction.md, _the web-only gap_).
// A bare "Preview images" here would promise that visitor something they can't
// have, and the Plus card's counterpart line would then read as "free users get
// no thumbnails", which is the opposite of what the tiers table says.
const FREE_FEATURES = [
  'End-to-end encryption — only you hold the key',
  'Sync across all your devices',
  'Browser extension and mobile share sheet',
  'Lists, tags, pins and search',
  'Link previews from the browser extension & mobile app',
  'Full data export, any time',
];

type PricingCard = {
  plan: Plan;
  price: string;
  cadence: string | null;
  priceNote: string;
  trialNote: string | null;
  blurb: string;
  features: readonly string[];
  inherits: string | null;
  cta: string;
  featured: boolean;
};

const CARDS: PricingCard[] = [
  {
    plan: 'free',
    price: '$0',
    cadence: null,
    priceNote: 'Free forever, no card required',
    trialNote: null,
    blurb: 'A private library, from your very first link',
    features: FREE_FEATURES,
    inherits: null,
    cta: 'Get started free',
    featured: false,
  },
  // The plans actually on sale. `featured` marks the entry paid tier — the one a
  // visitor should land on — so a future Pro card slots in without restyling.
  // Every card here is annual, which is also why every card gets the trial line:
  // the trial rides on the yearly price only (TRIAL_CADENCES).
  ...PLAN_CARDS.map(({ plan, blurb, features }, i) => ({
    plan,
    price: `$${PLAN_USD_PER_YEAR[plan]}`,
    cadence: '/year',
    priceNote: `${monthlyEquivalent(PLAN_USD_PER_YEAR[plan])} a month, billed annually`,
    trialNote: `${TRIAL_DAYS}-day free trial · cancel any time`,
    blurb,
    features,
    // Only the entry paid tier needs this line: every card above it already says
    // "Everything in <lower tier>" as its first feature in plans.ts.
    inherits: i === 0 ? 'Everything in Free, plus' : null,
    cta: 'Start your free trial',
    featured: i === 0,
  })),
];

// --- the comparison table -------------------------------------------------
// Columns are the storefront (`free` + whatever is on sale). Rows are functions
// of the plan so a new column fills itself in: anything that IS an entitlement
// reads `entitlementsOf`, and only the rows that are true everywhere — and so
// have no entitlement to read — are literals.
const COLUMNS: Plan[] = ['free', ...AVAILABLE_PAID_PLANS];

type Cell = string | boolean;

const COMPARISON: { label: string; cell: (plan: Plan) => Cell }[] = [
  // Saved links is the only numeric row, and the only limit a buyer has to
  // weigh — the storage quota is deliberately absent (see the header note).
  { label: 'Saved links', cell: formatLinks },
  { label: 'End-to-end encryption', cell: () => true },
  { label: 'Sync across devices', cell: () => true },
  { label: 'Browser extension & mobile share sheet', cell: () => true },
  // The previews pair, and the only two rows whose order matters: free's row
  // must sit ABOVE the paid one, so the table reads "you get previews, and Plus
  // covers the links your devices never touched" rather than implying free has
  // none. Neither is derivable from an entitlement — a preview image is not a
  // gate (every plan stores `files/` blobs), which is exactly why the copy has
  // to carry the distinction the data can't.
  { label: 'Link previews when you save from the extension or app', cell: () => true },
  { label: 'Lists, tags, pins & layouts', cell: () => true },
  { label: 'Search across your whole library', cell: () => true },
  { label: 'Full data export', cell: () => true },
  { label: 'Nested lists', cell: (p) => entitlementsOf(p).nestedLists },
  { label: 'App lock & hidden lists', cell: (p) => entitlementsOf(p).locks },
  { label: 'Search editor (fields, lists, tags)', cell: (p) => entitlementsOf(p).searchEditor },
  {
    label: 'Link previews for web saves & imports',
    cell: (p) => (entitlementsOf(p).serverExtraction ? 'Opt-in' : false),
  },
];

// --- the FAQ --------------------------------------------------------------
// Answers the questions the cards raise but can't answer, in the order a
// visitor asks them. Site copy, but anchored to the design record: the 200-link
// behaviour is the quota degradation in docs/iap.md (_enforcement_), the $48
// answer is docs/business-model.md (_pricing_), and the refund answer is the
// merchant-of-record split — Paddle is the legal seller, not us.
const FAQ: { q: string; a: string }[] = [
  {
    q: `What happens when I reach ${formatLinks('free')} links?`,
    a: 'Nothing is deleted, and nothing is locked away. Your library keeps working — read, search, edit, delete, and export everything — but new links stop saving until you upgrade or make room. Upgrading lifts the cap immediately.',
  },
  {
    q: 'Is there a free trial?',
    a: `Yes — Plus starts with a ${TRIAL_DAYS}-day free trial. Cancel before it ends and you are not charged. We suggest starting it when the free tier begins to pinch: the trial answers "is structure worth it for my library", which is a question you need a real library to answer.`,
  },
  {
    q: 'Do you offer a monthly plan?',
    a: 'Not yet — Bracemark is annual-only for now, at $48 a year. A monthly option is planned; until it exists we would rather sell one honest plan than a monthly plan you cannot switch out of.',
  },
  {
    q: 'Why $48 when other bookmark managers charge less?',
    a: 'Because the comparison that matters is not other bookmark managers. Obsidian Sync is about $48 a year for encrypted sync alone — no organization, no locks, no capture. Bracemark is that same encrypted-sync guarantee plus nested structure, locks, a query editor, a browser extension and a mobile share sheet.',
  },
  {
    q: 'What happens to my data if I stop paying?',
    a: 'You keep it. Your library stays readable, searchable and fully exportable on the free plan — you simply stop being able to add new links past the free cap. Full export is free on every plan, forever; charging you to leave would defeat the point of an app built so we cannot read your data in the first place.',
  },
  {
    q: 'Can you read my bookmarks?',
    a: 'No. Everything is encrypted on your device with a key derived from your password, and only the encrypted result is ever synced. That is true on the free plan too — encryption is not a paid feature here.',
  },
  {
    q: 'How do payments and refunds work?',
    a: `Payments are handled by Paddle, which is the merchant of record — it calculates and remits any sales tax or VAT, and Bracemark never sees your card details. If something has gone wrong, email ${SUPPORT_EMAIL} and we will sort it out; customers in the EU and UK also have a statutory 14-day right of withdrawal on top of that.`,
  },
];

// The lifetime launch lever — $149 once, for Plus forever, capped at
// LIFETIME_SEATS buyers. Renders NOTHING until the offer is actually on sale:
// lifetime is a one-time Paddle transaction and the webhook branch that applies
// one doesn't exist yet (docs/iap.md, _open follow-ups_), so a visible strip
// would either take money the server drops or advertise a thing nobody can buy.
// A hidden strip beats a "coming soon" one for the same reason the offer is
// capped at all: it is an urgency device, and urgency you cannot act on is noise.
function LifetimeStrip() {
  if (!LIFETIME_ON_SALE) return null;
  return (
    <section
      className={cn(
        'mx-auto mt-6 flex max-w-3xl flex-col items-center gap-4 rounded-xl border border-gray-900 bg-gray-50 p-6 text-center sm:flex-row sm:justify-between sm:text-left',
      )}
    >
      <div>
        <h2 className={cn('text-lg font-semibold text-gray-900')}>
          Lifetime {PLAN_LABELS[LIFETIME_PLAN]} — ${LIFETIME_USD} once
        </h2>
        <p className={cn('mt-1 text-sm text-gray-500')}>
          Pay once, keep {PLAN_LABELS[LIFETIME_PLAN]} forever. Limited to the first {LIFETIME_SEATS}{' '}
          people — then it is gone for good.
        </p>
      </div>
      <Button asChild className={cn('shrink-0')}>
        <a href={CREATE_ACCOUNT_URL}>Get lifetime</a>
      </Button>
    </section>
  );
}

// Not PageShell: that wrapper is a max-w-3xl single column for prose pages, and a
// card grid needs the landing page's width.
export default function Page() {
  return (
    <div className={cn('mx-auto w-full max-w-6xl px-4 pt-12 pb-8 md:px-6 lg:px-8')}>
      <section className={cn('mx-auto max-w-2xl text-center')}>
        <h1 className={cn('text-3xl leading-tight font-bold text-gray-900 lg:text-4xl')}>
          Pricing
        </h1>
        <p className={cn('mt-4 text-lg text-gray-500')}>
          Start free and keep {formatLinks('free')} links for as long as you like. Upgrade when your
          library outgrows it — with a {TRIAL_DAYS}-day free trial, and the same encryption, sync
          and export on every plan.
        </p>
      </section>

      <section className={cn('mt-12 flex flex-wrap justify-center gap-6')}>
        {CARDS.map((card) => (
          <div
            key={card.plan}
            className={cn(
              'flex w-full max-w-sm flex-col rounded-xl border p-6',
              card.featured ? 'border-gray-900 shadow-sm' : 'border-gray-200',
            )}
          >
            <div className={cn('flex items-baseline justify-between gap-2')}>
              <h2 className={cn('text-lg font-semibold text-gray-900')}>
                {PLAN_LABELS[card.plan]}
              </h2>
              {card.featured && (
                <span
                  className={cn(
                    'rounded-full bg-gray-900 px-2.5 py-0.5 text-xs font-medium text-white',
                  )}
                >
                  Most popular
                </span>
              )}
            </div>
            <p className={cn('mt-1 text-sm text-gray-500')}>{card.blurb}</p>

            <p className={cn('mt-6 flex items-baseline gap-1')}>
              <span className={cn('text-4xl font-bold text-gray-900')}>{card.price}</span>
              {card.cadence && <span className={cn('text-gray-500')}>{card.cadence}</span>}
            </p>
            <p className={cn('mt-1 text-sm text-gray-500')}>{card.priceNote}</p>
            {card.trialNote && (
              <p className={cn('mt-2 text-sm font-medium text-gray-900')}>{card.trialNote}</p>
            )}

            <p className={cn('mt-6 text-sm font-medium text-gray-900')}>{limitsLine(card.plan)}</p>
            {card.inherits && <p className={cn('mt-4 text-sm text-gray-500')}>{card.inherits}</p>}
            <ul className={cn('mt-2 flex flex-1 flex-col gap-2')}>
              {card.features.map((feature) => (
                <li key={feature} className={cn('flex items-start gap-2 text-sm text-gray-600')}>
                  <CheckIcon className={cn('mt-0.5 size-4 shrink-0 text-gray-400')} />
                  {feature}
                </li>
              ))}
            </ul>

            <Button asChild className={cn('mt-6')} variant={card.featured ? 'default' : 'outline'}>
              <a href={CREATE_ACCOUNT_URL}>{card.cta}</a>
            </Button>
          </div>
        ))}
      </section>

      <LifetimeStrip />

      {/* Compare — the table the cards can't be, without becoming a wall of text. */}
      <section className={cn('mx-auto mt-16 max-w-3xl')}>
        <h2 className={cn('text-center text-2xl font-bold text-gray-900')}>Compare plans</h2>
        {/* Narrow screens scroll the table itself; the page never scrolls sideways. */}
        <div className={cn('mt-6 overflow-x-auto')}>
          <table className={cn('w-full min-w-120 border-collapse text-left text-sm')}>
            <thead>
              <tr className={cn('border-b border-gray-200')}>
                <th scope="col" className={cn('py-3 pr-4 font-semibold text-gray-900')}>
                  Feature
                </th>
                {COLUMNS.map((plan) => (
                  <th
                    key={plan}
                    scope="col"
                    className={cn('w-28 px-4 py-3 text-center font-semibold text-gray-900')}
                  >
                    {PLAN_LABELS[plan]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className={cn('border-b border-gray-100')}>
                  <th scope="row" className={cn('py-3 pr-4 font-normal text-gray-600')}>
                    {row.label}
                  </th>
                  {COLUMNS.map((plan) => {
                    const value = row.cell(plan);
                    return (
                      <td key={plan} className={cn('px-4 py-3 text-center text-gray-900')}>
                        {typeof value === 'string' ? (
                          value
                        ) : value ? (
                          <>
                            <CheckIcon
                              className={cn('mx-auto size-4 text-gray-900')}
                              aria-hidden="true"
                            />
                            <span className={cn('sr-only')}>Included</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" className={cn('text-gray-300')}>
                              —
                            </span>
                            <span className={cn('sr-only')}>Not included</span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className={cn('mx-auto mt-16 max-w-3xl')}>
        <h2 className={cn('text-center text-2xl font-bold text-gray-900')}>Questions</h2>
        <dl className={cn('mt-6 space-y-6')}>
          {FAQ.map(({ q, a }) => (
            <div key={q}>
              <dt className={cn('text-base font-semibold text-gray-900')}>{q}</dt>
              <dd className={cn('mt-2 text-base text-gray-600')}>{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        className={cn('mx-auto mt-16 max-w-2xl space-y-3 text-center text-sm text-gray-500')}
      >
        <p>
          Every plan is end-to-end encrypted, syncs across your devices, and exports your whole
          library whenever you want it — there is no lock-in tier.
        </p>
        <p>
          Prices are in US dollars. Payments are handled by Paddle, which calculates any tax at
          checkout; Bracemark never sees your card details.
        </p>
        <p>
          Already have an account? Upgrade from{' '}
          <a className={cn('underline hover:text-gray-900')} href={UPGRADE_URL}>
            Settings → Subscription
          </a>
          .
        </p>
      </section>
    </div>
  );
}
