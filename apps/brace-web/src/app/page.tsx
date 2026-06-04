import Image from 'next/image';
import Link from 'next/link';

import { AppStoreIcon } from '@stxapps/web-ui/components/icons/app-store-icon';
import { BraceIcon } from '@stxapps/web-ui/components/icons/brace-icon';
import { ChromeWebStoreIcon } from '@stxapps/web-ui/components/icons/chrome-web-store-icon';
import { FirefoxAddonsIcon } from '@stxapps/web-ui/components/icons/firefox-addons-icon';
import { PlayStoreIcon } from '@stxapps/web-ui/components/icons/play-store-icon';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { cn } from '@stxapps/web-ui/lib/utils';

import saveLinksToVisitLater from '../assets/images/save-links-to-visit-later.svg';

export default function Page() {
  return (
    <div>
      <div className={cn(`mx-auto max-w-6xl px-4 md:px-6 lg:px-8 bg-white`)}>
        <div className={cn('relative')}>
          <div className={cn('flex h-14 items-center justify-between')}>
            <Link className={cn('relative rounded focus:outline-none focus:ring focus:ring-offset-2 blk:focus:ring-offset-gray-900')} href="/">
              <BraceIcon className={cn('h-8 w-auto')} aria-label="Brace logo" />
            </Link>
            <Button asChild variant="outline">
              <Link href="/sign-in">Sign in</Link>
            </Button>
          </div>
        </div>
      </div>
      <div className={cn('mx-auto flow-root w-full max-w-6xl bg-white')}>
        <section className={cn('flex items-center px-4 pt-16 pb-4 md:px-6 lg:px-8 lg:pt-12')}>
          <div className={cn('w-full md:w-[55%] lg:pt-10')}>
            <Image
              className={cn('mx-auto w-11/12 max-w-sm object-contain md:hidden')}
              src={saveLinksToVisitLater}
              alt="Save links to visit later"
              priority={true}
            />
            <h1 className={cn('first-h1-text mt-16 leading-none font-bold text-gray-900 md:mt-0')}>
              Save links <br className={cn('inline sm:hidden md:inline lg:hidden')} />
              to visit later
            </h1>
            <p className={cn('mt-4 text-lg font-normal text-gray-500 md:pr-4')}>
              Your bookmark manager with privacy at heart. Brace.to helps you save links to
              everything and visit them later easily, anytime, on any of your devices. Powered by
              Crypto technology, all your saved links are encrypted, and only you can decrypt them
              and see the content inside.
            </p>
            <Button asChild className={cn('mt-6')}>
              <Link href="/create-account">
                <span className={cn('text-lg font-medium')}>Get Started</span>
              </Link>
            </Button>
            <div className={cn('mt-3 flex items-end md:mt-4')}>
              <a
                className={cn('group focus:outline-none')}
                href="https://play.google.com/store/apps/details?id=com.bracedotto"
                target="_blank"
                rel="noreferrer"
              >
                <PlayStoreIcon
                  className={cn('w-6 rounded-xs group-focus:ring md:w-8')}
                  aria-label="Play store"
                />
              </a>
              <a
                className={cn('group focus:outline-none')}
                href="https://apps.apple.com/us/app/id1531456778"
                target="_blank"
                rel="noreferrer"
              >
                <AppStoreIcon
                  className={cn('ml-4 w-6 rounded-xs group-focus:ring md:w-8')}
                  aria-label="App store"
                />
              </a>
              <a
                className={cn('group focus:outline-none')}
                href="https://chrome.google.com/webstore/detail/brace/hennjddhjodlmdnopaggbjjkpokpbdnn"
                target="_blank"
                rel="noreferrer"
              >
                <ChromeWebStoreIcon
                  className={cn('ml-4 w-6 rounded-xs group-focus:ring md:w-8')}
                  aria-label="Chrome web store"
                />
              </a>
              <a
                className={cn('group focus:outline-none')}
                href="https://addons.mozilla.org/en-US/firefox/addon/brace/"
                target="_blank"
                rel="noreferrer"
              >
                <FirefoxAddonsIcon
                  className={cn('-mb-0.5 ml-4 w-7 rounded-xs group-focus:ring md:w-10')}
                  aria-label="Firefox addons"
                />
              </a>
            </div>
          </div>
          <div className={cn('hidden md:block md:w-[45%]')}>
            <Image
              className={cn('ml-auto object-contain md:w-full lg:w-11/12')}
              src={saveLinksToVisitLater}
              alt="Save links to visit later"
              priority={true}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
