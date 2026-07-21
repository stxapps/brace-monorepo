import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { themeInitScript } from '@stxapps/shared';

import { InnerLayout } from './inner-layout';

import './globals.css';

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: 'rgb(17, 24, 39)' },
  ],
};

export const metadata: Metadata = {
  title: 'Brace.to - Save links to visit later',
  description:
    'Save links to everything and visit them later easily, anytime, on any device, with technology that empowers you to truly own your account and data.',
  openGraph: {
    title: 'Brace.to - Save links to visit later',
    description:
      'Save links to everything and visit them later easily, anytime, on any device, with technology that empowers you to truly own your account and data.',
    images: [
      {
        url: 'https://brace.to/twitter-card-image-pattern5.png',
      },
    ],
    siteName: 'Brace.to',
    url: 'https://brace.to',
    type: 'website',
  },
  twitter: {
    title: 'Brace.to - Save links to visit later',
    description:
      'Save links to everything and visit them later easily, anytime, on any device, with technology that empowers you to truly own your account and data.',
    images: ['https://brace.to/twitter-card-image-pattern5.png'],
    card: 'summary_large_image',
    site: '@bracedotto',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        {/* Set the `.dark` class before paint so there's no flash of the wrong
            theme. Runs synchronously ahead of hydration. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
        <InnerLayout>{children}</InnerLayout>
      </body>
    </html>
  );
}
