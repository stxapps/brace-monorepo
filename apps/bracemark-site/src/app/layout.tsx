import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono, Inter } from 'next/font/google';

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
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
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

const DESCRIPTION =
  'Bracemark is an end-to-end encrypted bookmark manager. Every link is encrypted on your device before it syncs, so the server holds ciphertext and nothing else.';

const TITLE = 'Bracemark — the bookmark manager that can’t read your bookmarks';

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
