'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import {
  coerceThemeState,
  DEFAULT_THEME,
  type EffectiveTheme,
  msUntilNextThemeSwitch,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
  type ThemeState,
} from '@stxapps/shared';

/**
 * Persistence is injected so each app controls *where* the preference lives:
 * brace-web uses localStorage; brace-extension uses browser.storage.sync
 * (cross-context + cross-device) mirrored to localStorage for the FOUC script.
 */
export interface ThemeStorage {
  get: () => Promise<ThemeState | null> | ThemeState | null;
  set: (state: ThemeState) => void;
  /** Notify on external changes (other tab / popup / device). Optional. */
  subscribe?: (cb: (state: ThemeState) => void) => () => void;
}

interface ThemeContextValue {
  /** The stored preference (one of the four modes + custom times). */
  state: ThemeState;
  /** What's actually rendered right now. */
  effective: EffectiveTheme;
  setState: (state: ThemeState) => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function ThemeProvider({
  storage,
  children,
}: {
  storage: ThemeStorage;
  children: React.ReactNode;
}) {
  const [state, setRaw] = useState<ThemeState>(DEFAULT_THEME);
  const [effective, setEffective] = useState<EffectiveTheme>('light');

  // Latest state for callbacks that patch it, without re-subscribing effects.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Hydrate once, then stay in sync with external writes (other contexts).
  useEffect(() => {
    let active = true;
    Promise.resolve(storage.get()).then((s) => {
      if (active && s) setRaw(s);
    });
    const unsubscribe = storage.subscribe?.((s) => setRaw(s));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [storage]);

  // Resolve + apply on every state change, and re-resolve on the triggers each
  // mode depends on: `system` → OS preference change; `custom` → next crossover.
  useEffect(() => {
    const apply = () => {
      const next = resolveTheme(state, {
        now: new Date(),
        systemPrefersDark: systemPrefersDark(),
      });
      document.documentElement.classList.toggle('dark', next === 'dark');
      setEffective(next);
    };
    apply();

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const ms = msUntilNextThemeSwitch(state, new Date());
      if (ms != null) {
        timer = setTimeout(
          () => {
            apply();
            schedule();
          },
          Math.max(ms, 0) + 1000, // +1s cushion so we land past the boundary
        );
      }
    };
    schedule();

    return () => {
      mq.removeEventListener('change', apply);
      if (timer) clearTimeout(timer);
    };
  }, [state]);

  const setState = useCallback(
    (next: ThemeState) => {
      setRaw(next);
      storage.set(next);
    },
    [storage],
  );

  const setMode = useCallback(
    (mode: ThemeMode) => setState({ ...stateRef.current, mode }),
    [setState],
  );

  return (
    <ThemeContext.Provider value={{ state, effective, setState, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a <ThemeProvider>');
  return ctx;
}

/**
 * Ready-made adapter for plain web pages (brace-web). The `storage` event gives
 * cross-tab sync for free. Construct once at module scope so its identity is
 * stable across renders.
 */
export function localStorageThemeStorage(key: string = THEME_STORAGE_KEY): ThemeStorage {
  return {
    get: () => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? coerceThemeState(JSON.parse(raw)) : null;
      } catch {
        return null;
      }
    },
    set: (state) => {
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {
        // ignore quota / privacy-mode failures
      }
    },
    subscribe: (cb) => {
      const handler = (e: StorageEvent) => {
        if (e.key === key && e.newValue) {
          try {
            cb(coerceThemeState(JSON.parse(e.newValue)));
          } catch {
            // ignore malformed payloads
          }
        }
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
  };
}
