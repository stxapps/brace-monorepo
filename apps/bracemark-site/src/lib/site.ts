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

// The published support address, and the contact of record for App Store, Play,
// and Paddle review. The domain is registered; the mailbox (Namecheap Private
// Email) and its hand-added Cloudflare MX/SPF/DKIM records are provisioning work
// tracked in docs/deployment.md — _email_.
export const SUPPORT_EMAIL = 'support@bracemark.com';

export const HEADER_LINKS = [
  { href: '/docs', label: 'Docs' },
  { href: '/blog', label: 'Blog' },
  { href: '/about', label: 'About' },
  { href: '/support', label: 'Support' },
] as const;

export const FOOTER_LINKS = [
  {
    heading: 'Product',
    links: [
      { href: '/docs', label: 'Docs' },
      { href: '/blog', label: 'Blog' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact' },
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
