import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from 'next/font/google';

import { BRAND } from '@stxapps/shared';
import { cn } from '@stxapps/web-ui/lib/utils';

import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { SITE_URL } from '../lib/site';

import './globals.css';

// Three faces, each bound to a CSS variable the site's `@theme` block reads
// (globals.css explains what each voice is FOR). All self-hosted by next/font at
// build time — no runtime request to Google, which matters on a page that sells
// not being tracked.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
// `axes` is the optical size, and it is not optional decoration. Bricolage
// carries three axes — opsz 12..96, wdth 75..100, wght 200..800 — and asking
// for none of them lands you on the fvar defaults for the two you skipped.
// For opsz that default is NOT 96 despite what the served file's family name
// ("Bricolage Grotesque 96pt ExtraBold") suggests: that string is nameID 1 of
// the whole variable font, carried into the subset unchanged. Measured against
// the variable font swept across opsz, the subset we were shipping matches
// opsz 12-18 — the TEXT cut — which the site was then using for headlines up
// to 48px. Requesting the axis lets `font-optical-sizing: auto` (the browser
// default) pick per size, so headlines get the display cut and the 18px
// wordmark in site-header.tsx keeps the text cut it already had.
//
// `wdth` is deliberately NOT requested; see globals.css for why.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz'],
  variable: '--font-bricolage',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

// Kept as a full sentence rather than assembled from BRAND: a meta description is
// its own form (~155 characters, mechanism first, no call to action), and this one
// is the only place the whole argument gets to be prose. Google truncates past
// roughly 160, so the room is already spent.
const DESCRIPTION =
  'Bracemark is an end-to-end encrypted bookmark manager. Every link is encrypted on your device before it syncs, so the server holds ciphertext and nothing else.';

// The tagline itself, verbatim from shared's stores/listing-copy.ts, so the OG
// title, the hero, and every store listing say one sentence rather than four
// versions of it. 63 characters — past where Google truncates a title in results,
// which is accepted here: the tagline IS the pitch, and the brand name and the
// category both land inside the first 40.
const TITLE = `${BRAND.name} — ${BRAND.tagline}`;

export const metadata: Metadata = {
  // This app serves the APEX (docs/deployment.md) — bracemark-web serves `app.` and
  // sets its own metadataBase. Card images, which must be absolute, resolve against
  // this origin and live in this app's `public/`.
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · Bracemark',
  },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: '/twitter-card-image-pattern5.png' }],
    siteName: 'Bracemark',
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    title: TITLE,
    description: DESCRIPTION,
    images: ['/twitter-card-image-pattern5.png'],
    card: 'summary_large_image',
    // `site:` deliberately omitted: it held @bracedotto, the legacy Brace.to handle.
    // Set it once a Bracemark handle actually exists — a wrong handle credits
    // someone else's account on every share.
  },
};

// No ThemeProvider and no pre-paint theme script here, unlike bracemark-web's root
// layout. The theme's source of truth is the user's synced settings, read through
// `@stxapps/web-react` (Dexie) — a data layer this site must not pull in, and could
// not read anyway: it's a different origin, so it doesn't even share bracemark-web's
// localStorage mirror. The marketing pages are therefore light-only for now.
//
// They are nonetheless written against the shadcn TOKENS (`bg-background`,
// `text-muted-foreground`, `border-border`) rather than literal greys, so giving
// them a theme later is adding the provider, not repainting seven pages.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn(inter.variable, bricolage.variable, plexMono.variable)}>
      <body>
        <div className={cn('bg-background text-foreground flex min-h-dvh flex-col antialiased')}>
          <SiteHeader />
          <main className={cn('flex-1')}>{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
