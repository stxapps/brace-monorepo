import type { Metadata } from 'next';
import Link from 'next/link';

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

import { ArrowGlyph, CheckGlyph } from '../../components/glyphs';
import { faqById, PRICING_FAQ_IDS } from '../../content/faq';
import { CREATE_ACCOUNT_URL, UPGRADE_URL } from '../../lib/site';

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
// What is site-owned copy, and why: the FREE card's feature list and the
// non-entitlement comparison rows (encryption, sync, export — true on every plan,
// so there is nothing to derive them from). plans.ts holds card copy for the PAID
// plans only, since both storefronts render upgrade cards and never a free one.
// Keep those in step with docs/business-model.md by hand; every number a buyer
// could be misled by still comes from the data.
//
// The FAQ below is NOT site-owned copy any more: it is four entries pulled by id
// from `content/faq.tsx`, the same source /faq renders in full. Two hand-kept
// copies of the refund position is exactly the drift the rest of this file exists
// to prevent.
//
// TODO before launch: the launch-lever copy ("early supporters keep this price"),
// and the monthly cadence if `AVAILABLE_CADENCES` grows — a cadence toggle, not a
// second card, since monthly is the same entitlement billed differently.

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
        'border-signal-line bg-signal-soft mx-auto mt-8 flex max-w-3xl flex-col items-center gap-5 rounded-2xl border p-7 text-center sm:flex-row sm:justify-between sm:text-left',
      )}
    >
      <div>
        <h2 className={cn('font-display text-lg font-semibold tracking-tight')}>
          Lifetime {PLAN_LABELS[LIFETIME_PLAN]} — ${LIFETIME_USD} once
        </h2>
        <p className={cn('text-muted-foreground mt-1.5 text-sm leading-6')}>
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

// Not PageShell: that wrapper is a single prose column, and a card grid plus a
// comparison table needs the landing page's width.
export default function Page() {
  return (
    <div className={cn('mx-auto w-full max-w-6xl px-4 pt-14 pb-4 md:px-6 md:pt-20 lg:px-8')}>
      <section className={cn('mx-auto max-w-2xl text-center')}>
        <p className={cn('eyebrow')}>Pricing</p>
        <h1
          className={cn(
            'font-display mt-3 text-4xl leading-[1.05] font-semibold tracking-tight text-balance md:text-5xl',
          )}
        >
          Two plans. One of them is free.
        </h1>
        <p className={cn('text-muted-foreground mt-5 text-lg leading-8')}>
          Start free and keep {formatLinks('free')} links for as long as you like. Upgrade when your
          library outgrows it — with a {TRIAL_DAYS}-day free trial, and the same encryption, sync
          and export on every plan.
        </p>
      </section>

      <section className={cn('mt-14 flex flex-wrap justify-center gap-6')}>
        {CARDS.map((card) => (
          <div
            key={card.plan}
            className={cn(
              'flex w-full max-w-sm flex-col rounded-2xl border p-7',
              // The featured plan is the one place besides the hero panel where
              // the accent carries meaning rather than decoration.
              card.featured ? 'border-signal-line bg-signal-soft/60 shadow-sm' : 'border-border',
            )}
          >
            <div className={cn('flex items-baseline justify-between gap-2')}>
              <h2 className={cn('font-display text-lg font-semibold tracking-tight')}>
                {PLAN_LABELS[card.plan]}
              </h2>
              {card.featured && (
                <span
                  className={cn(
                    'bg-signal text-background rounded-full px-2.5 py-0.5 font-mono text-[0.625rem] tracking-wider uppercase',
                  )}
                >
                  Most popular
                </span>
              )}
            </div>
            <p className={cn('text-muted-foreground mt-1.5 text-sm')}>{card.blurb}</p>

            <p className={cn('mt-7 flex items-baseline gap-1')}>
              <span className={cn('font-display text-5xl font-semibold tracking-tight')}>
                {card.price}
              </span>
              {card.cadence && <span className={cn('text-muted-foreground')}>{card.cadence}</span>}
            </p>
            <p className={cn('text-muted-foreground mt-1.5 text-sm')}>{card.priceNote}</p>
            {card.trialNote && (
              <p className={cn('text-signal mt-2 font-mono text-xs')}>{card.trialNote}</p>
            )}

            <p className={cn('border-border mt-7 border-t pt-5 text-sm font-medium')}>
              {limitsLine(card.plan)}
            </p>
            {card.inherits && (
              <p className={cn('text-muted-foreground mt-4 text-sm')}>{card.inherits}</p>
            )}
            <ul className={cn('mt-3 flex flex-1 flex-col gap-2.5')}>
              {card.features.map((feature) => (
                <li
                  key={feature}
                  className={cn('text-muted-foreground flex items-start gap-2.5 text-sm leading-6')}
                >
                  <CheckGlyph
                    className={cn('mt-1 size-3.5 shrink-0', card.featured ? 'text-signal' : '')}
                  />
                  {feature}
                </li>
              ))}
            </ul>

            <Button asChild className={cn('mt-7')} variant={card.featured ? 'default' : 'outline'}>
              <a href={CREATE_ACCOUNT_URL}>{card.cta}</a>
            </Button>
          </div>
        ))}
      </section>

      <LifetimeStrip />

      {/* Compare — the table the cards can't be, without becoming a wall of text. */}
      <section className={cn('mx-auto mt-24 max-w-3xl')}>
        <p className={cn('eyebrow text-center')}>Side by side</p>
        <h2 className={cn('font-display mt-3 text-center text-3xl font-semibold tracking-tight')}>
          Compare plans
        </h2>
        {/* Narrow screens scroll the table itself; the page never scrolls sideways.
            `relative` is load-bearing, not decoration: each cell's Included /
            Not included label is `sr-only`, which is ABSOLUTELY positioned. With
            no positioned ancestor those labels resolve against the initial
            containing block, so a cell 480px into the scrolled table lands 480px
            into the DOCUMENT and drags the page's scrollWidth out with it — a
            real sideways scrollbar at 390px, caused by text nobody can see.
            Making this the containing block keeps them inside the scroller. */}
        <div className={cn('relative mt-8 overflow-x-auto')}>
          <table className={cn('w-full min-w-120 border-collapse text-left text-sm')}>
            <thead>
              <tr className={cn('border-foreground/15 border-b')}>
                <th scope="col" className={cn('eyebrow py-3 pr-4')}>
                  Feature
                </th>
                {COLUMNS.map((plan) => (
                  <th
                    key={plan}
                    scope="col"
                    className={cn('font-display w-28 px-4 py-3 text-center font-semibold')}
                  >
                    {PLAN_LABELS[plan]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map((row) => (
                <tr key={row.label} className={cn('border-border border-b')}>
                  <th scope="row" className={cn('text-muted-foreground py-3.5 pr-4 font-normal')}>
                    {row.label}
                  </th>
                  {COLUMNS.map((plan) => {
                    const value = row.cell(plan);
                    return (
                      <td key={plan} className={cn('px-4 py-3.5 text-center')}>
                        {typeof value === 'string' ? (
                          value
                        ) : value ? (
                          <>
                            <CheckGlyph className={cn('text-signal mx-auto size-4')} />
                            <span className={cn('sr-only')}>Included</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true" className={cn('text-border')}>
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

      {/* The four billing questions, pulled by id from the shared FAQ. */}
      <section className={cn('mx-auto mt-24 max-w-3xl')}>
        <p className={cn('eyebrow text-center')}>Before you decide</p>
        <h2 className={cn('font-display mt-3 text-center text-3xl font-semibold tracking-tight')}>
          The fine print, in plain words
        </h2>
        <dl className={cn('mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2')}>
          {PRICING_FAQ_IDS.map((id) => {
            const item = faqById(id);
            if (!item) return null;
            return (
              <div key={id} className={cn('border-border border-t pt-5')}>
                <dt className={cn('text-base leading-7 font-semibold text-balance')}>{item.q}</dt>
                <dd className={cn('text-muted-foreground mt-2 text-[0.9375rem] leading-7')}>
                  {item.a}
                </dd>
              </div>
            );
          })}
        </dl>
        <p className={cn('mt-10 text-center')}>
          <Link
            className={cn(
              'text-signal decoration-signal-line hover:decoration-signal focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-sm text-sm font-medium underline underline-offset-4 focus-visible:ring-3 focus-visible:outline-none',
            )}
            href="/faq"
          >
            Every other question
            <ArrowGlyph className={cn('size-4')} />
          </Link>
        </p>
      </section>

      <section
        className={cn(
          'border-border text-muted-foreground mx-auto mt-24 max-w-2xl space-y-3 border-t pt-10 text-center text-sm leading-6',
        )}
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
          <a
            className={cn('text-signal decoration-signal-line underline underline-offset-2')}
            href={UPGRADE_URL}
          >
            Settings → Subscription
          </a>
          .
        </p>
      </section>
    </div>
  );
}
