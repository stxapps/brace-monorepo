import Link from 'next/link';

import { cn } from '@stxapps/web-ui/lib/utils';

import { FOOTER_LINKS } from '../lib/site';

export function SiteFooter() {
  return (
    <footer className={cn('mx-auto max-w-6xl px-4 py-12 md:px-6 lg:px-8')}>
      <div className={cn('grid grid-cols-2 gap-8 sm:grid-cols-3')}>
        {FOOTER_LINKS.map((group) => (
          <div key={group.heading}>
            <h2 className={cn('text-sm font-semibold text-gray-900')}>{group.heading}</h2>
            <ul className={cn('mt-3 space-y-2')}>
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    className={cn('text-sm text-gray-500 hover:text-gray-900')}
                    href={link.href}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className={cn('mt-10 text-sm text-gray-400')}>
        © {new Date().getFullYear()} Bracemark. All rights reserved.
      </p>
    </footer>
  );
}
