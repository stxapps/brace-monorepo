// The marketing site's own configuration: where it lives, where the app lives, and
// the two nav structures the header and footer render from.
//
// The app URL is env-configured (`.env.*`), not hard-coded, for the same reason
// bracemark-web's API URL is: it differs per tier (`app.bracemark.com` vs
// `app.staging.bracemark.com` vs `localhost:3000`) and is baked at build time.
// See docs/env-files.md — _bracemark-site_.

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.bracemark.com';

/** The apex this site is served from — used for canonical/OG absolute URLs. */
export const SITE_URL = 'https://bracemark.com';

/** Deep links into bracemark-web. The site never renders auth UI itself. */
export const SIGN_IN_URL = `${APP_URL}/sign-in`;
export const CREATE_ACCOUNT_URL = `${APP_URL}/create-account`;
// Checkout lives in the app, not here: a Paddle transaction is minted per ACCOUNT
// (POST /v1/iap/checkout stamps the account binding), so there is nothing this
// origin — which has no session — can start. /pricing therefore sends new visitors
// to create-account and returning ones to the settings section that owns the flow.
export const UPGRADE_URL = `${APP_URL}/settings/subscription`;

// The published support address, and the contact of record for App Store, Play,
// and Paddle review. The domain is registered; the mailbox (Namecheap Private
// Email) and its hand-added Cloudflare MX/SPF/DKIM records are provisioning work
// tracked in docs/deployment.md — _email_.
export const SUPPORT_EMAIL = 'support@bracemark.com';

// The inbound-only alias for vulnerability reports — an alias on the same Private
// Email plan, not a second mailbox (docs/deployment.md — _email_). Published
// separately from support@ so a security report doesn't queue behind "how do I
// import from Raindrop".
export const SECURITY_EMAIL = 'security@bracemark.com';

// The legal entity behind Bracemark, and the postal address of record.
//
// Named here once because three surfaces need the identical string — /terms,
// /privacy, and the footer's copyright line — and a company name that disagrees
// with itself across a store submission is a review rejection. This is the same
// entity that published Brace.to; the app was renamed (docs/brand.md), the
// company was not.
//
// TODO before publishing: confirm the postal address is still current. It is
// carried forward from the legacy Brace.to policies, and Apple, Google and Paddle
// all check that a published address resolves.
export const COMPANY = {
  legalName: 'STX Apps Co., Ltd.',
  shortName: 'STX Apps',
  attn: 'Bracemark Team',
  addressLines: ['247 Chan 31 Sathon', 'Bangkok 10120', 'Thailand'],
} as const;

// The "last updated" line each policy carries. Dates live here rather than inline
// so the two documents can never claim different vintages of the same rewrite —
// and so bumping one after an edit is a deliberate act, not a forgotten one.
export const TERMS_UPDATED = '5 August 2026';
export const PRIVACY_UPDATED = '5 August 2026';

export const HEADER_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/support', label: 'Support' },
] as const;

export const FOOTER_LINKS = [
  {
    heading: 'Product',
    links: [
      { href: '/pricing', label: 'Pricing' },
      { href: '/faq', label: 'FAQ' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/support', label: 'Support' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy' },
    ],
  },
] as const;
