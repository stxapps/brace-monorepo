'use client';
import { Suspense, useEffect } from 'react';
import { SerwistProvider } from '@serwist/next/react';

import { localStorageThemeStorage, ThemeProvider } from '@stxapps/web-ui/theme';

// Stable identity across renders (the provider keys effects off it).
const themeStorage = localStorageThemeStorage();

function Initializer() {
  useEffect(() => {
    if (!('serviceWorker' in navigator && window.serwist !== undefined)) return;

    const mediaQuery = window.matchMedia('(display-mode: standalone)');

    let didListenMedia = false,
      didRegister = false;
    const onWaiting = () => {
      //dispatch(showSWWUPopup());
    };
    const register = () => {
      if (didRegister) return;
      window.serwist.register();
      window.serwist.addEventListener('waiting', onWaiting);
      didRegister = true;
    };
    const onMediaChange = () => {
      if (mediaQuery.matches) register();
    };
    const check = async () => {
      if (mediaQuery.matches) {
        register();
        return;
      }

      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        register();
        return;
      }

      mediaQuery.addEventListener('change', onMediaChange);
      didListenMedia = true;
    };

    check();
    return () => {
      if (didListenMedia) mediaQuery.removeEventListener('change', onMediaChange);
      if (didRegister) window.serwist.removeEventListener('waiting', onWaiting);
    };
  }, []);

  return null;
}

function SafeArea({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

export function InnerLayout({ children }: { children: React.ReactNode }) {
  return (
    // SerwistProvider sets up `window.serwist` (which the plugin used to inject
    // automatically). We keep manual, conditional registration via Initializer
    // below, so register/cacheOnNavigation/reloadOnOnline are all off here to
    // preserve the previous behavior. Disabled in dev since `serwist build`
    // only runs as part of the production build.
    <SerwistProvider
      swUrl="/sw.js"
      register={false}
      cacheOnNavigation={false}
      reloadOnOnline={false}
      disable={process.env.NODE_ENV === 'development'}
    >
      <Suspense fallback={null}>
        <Initializer />
      </Suspense>
      <ThemeProvider storage={themeStorage}>
        <SafeArea>{children}</SafeArea>
      </ThemeProvider>
    </SerwistProvider>
  );
}
