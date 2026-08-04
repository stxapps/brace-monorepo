import Link from 'next/link';

import { BracemarkIcon } from '@stxapps/web-ui/components/icons/bracemark-icon';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { cn } from '@stxapps/web-ui/lib/utils';

import { HEADER_LINKS, SIGN_IN_URL } from '../lib/site';

// "Sign in" is a plain <a>, not next/link: it crosses origins (bracemark.com →
// app.bracemark.com), so there is no client-side navigation to prefetch and
// next/link would only add a router entry for a full page load.
export function SiteHeader() {
  return (
    <header className={cn('mx-auto max-w-6xl px-4 md:px-6 lg:px-8')}>
      <div className={cn('flex h-14 items-center justify-between')}>
        <Link
          className={cn('relative rounded focus:ring focus:ring-offset-2 focus:outline-none')}
          href="/"
        >
          <BracemarkIcon className={cn('h-8 w-auto')} aria-label="Bracemark logo" />
        </Link>
        <nav className={cn('flex items-center gap-6')}>
          <ul className={cn('hidden items-center gap-6 sm:flex')}>
            {HEADER_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  className={cn('text-sm font-medium text-gray-600 hover:text-gray-900')}
                  href={link.href}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className={cn('bg-background hover:bg-input/30')}>
            <a href={SIGN_IN_URL}>Sign in</a>
          </Button>
        </nav>
      </div>
    </header>
  );
}
