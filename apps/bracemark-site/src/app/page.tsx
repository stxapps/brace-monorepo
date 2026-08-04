import Image from 'next/image';

import {
  APP_STORE_URL,
  CHROME_WEB_STORE_URL,
  FIREFOX_ADDONS_URL,
  PLAY_STORE_URL,
} from '@stxapps/shared';
import { AppStoreIcon } from '@stxapps/web-ui/components/icons/app-store-icon';
import { ChromeWebStoreIcon } from '@stxapps/web-ui/components/icons/chrome-web-store-icon';
import { FirefoxAddonsIcon } from '@stxapps/web-ui/components/icons/firefox-addons-icon';
import { PlayStoreIcon } from '@stxapps/web-ui/components/icons/play-store-icon';
import { Button } from '@stxapps/web-ui/components/ui/button';
import { cn } from '@stxapps/web-ui/lib/utils';

import saveLinksToVisitLater from '../assets/images/save-links-to-visit-later.svg';
import { CREATE_ACCOUNT_URL } from '../lib/site';

// Moved here from bracemark-web when the apex became this app (docs/brand.md,
// docs/deployment.md). Two things changed with the move, both consequences of the
// site being a different origin from the app:
//   - the `AuthedHomeRedirect` that bounced signed-in visitors to /links is gone —
//     this origin has no session to read. bracemark-web's own `/` handles that now.
//   - "Get Started" is a cross-origin <a> to app.bracemark.com, not a next/link.
export default function Page() {
  return (
    <div className={cn('mx-auto flow-root w-full max-w-6xl')}>
      <section className={cn('flex items-center px-4 pt-16 pb-4 md:px-6 lg:px-8 lg:pt-12')}>
        <div className={cn('w-full md:w-[55%] lg:pt-10')}>
          <Image
            className={cn('mx-auto w-11/12 max-w-sm object-contain md:hidden')}
            src={saveLinksToVisitLater}
            alt="Save links to visit later"
            priority={true}
          />
          <h1
            className={cn(
              'mt-16 text-4xl leading-none font-bold text-gray-900 md:mt-0 lg:text-5xl',
            )}
          >
            Save links <br className={cn('inline sm:hidden md:inline lg:hidden')} />
            to visit later
          </h1>
          <p className={cn('mt-4 text-lg font-normal text-gray-500 md:pr-4')}>
            Your bookmark manager with privacy at heart. Bracemark helps you save links to
            everything and visit them later easily, anytime, on any of your devices. Powered by
            Crypto technology, all your saved links are encrypted, and only you can decrypt them and
            see the content inside.
          </p>
          <Button asChild className={cn('mt-6')}>
            <a href={CREATE_ACCOUNT_URL}>
              <span className={cn('text-lg font-medium')}>Get Started</span>
            </a>
          </Button>
          <div className={cn('mt-3 flex items-end md:mt-4')}>
            <a
              className={cn('group focus:outline-none')}
              href={PLAY_STORE_URL}
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
              href={APP_STORE_URL}
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
              href={CHROME_WEB_STORE_URL}
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
              href={FIREFOX_ADDONS_URL}
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
  );
}
