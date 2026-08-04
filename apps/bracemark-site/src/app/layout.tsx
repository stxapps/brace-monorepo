import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { cn } from '@stxapps/web-ui/lib/utils';

import { SiteFooter } from '../components/site-footer';
import { SiteHeader } from '../components/site-header';
import { SITE_URL } from '../lib/site';

import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

const DESCRIPTION =
  'Save links to everything and visit them later easily, anytime, on any device, with technology that empowers you to truly own your account and data.';

export const metadata: Metadata = {
  // This app serves the APEX (docs/deployment.md) — bracemark-web serves `app.` and
  // sets its own metadataBase. Card images, which must be absolute, resolve against
  // this origin and live in this app's `public/`.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Bracemark - Save links to visit later',
    template: '%s · Bracemark',
  },
  description: DESCRIPTION,
  openGraph: {
    title: 'Bracemark - Save links to visit later',
    description: DESCRIPTION,
    images: [{ url: '/twitter-card-image-pattern5.png' }],
    siteName: 'Bracemark',
    url: SITE_URL,
    type: 'website',
  },
  twitter: {
    title: 'Bracemark - Save links to visit later',
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
// localStorage mirror. The marketing pages are therefore light-only for now; giving
// them their own `prefers-color-scheme` styling is a separate, self-contained change.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>
        <div className={cn('min-h-dvh bg-white')}>
          <SiteHeader />
          <main>{children}</main>
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
