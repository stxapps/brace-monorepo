import React from 'react';
import ReactDOM from 'react-dom/client';

import { coerceThemeState, THEME_STORAGE_KEY, type ThemeState } from '@stxapps/shared';
import { ThemeProvider, type ThemeStorage } from '@stxapps/web-ui/theme';

import App from './App.tsx';

import './style.css';

// Source of truth is browser.storage.sync (shared across popup/background and
// synced across devices). We also mirror to localStorage so the synchronous
// FOUC script in index.html can read it before paint.
function mirror(state: ThemeState) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const themeStorage: ThemeStorage = {
  get: async () => {
    const res = await browser.storage.sync.get(THEME_STORAGE_KEY);
    const raw = res[THEME_STORAGE_KEY];
    if (raw == null) return null;
    const state = coerceThemeState(raw);
    mirror(state);
    return state;
  },
  set: (state) => {
    browser.storage.sync.set({ [THEME_STORAGE_KEY]: state });
    mirror(state);
  },
  subscribe: (cb) => {
    const handler: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      changes,
      area,
    ) => {
      if (area !== 'sync') return;
      const change = changes[THEME_STORAGE_KEY];
      if (change && change.newValue != null) {
        const state = coerceThemeState(change.newValue);
        mirror(state);
        cb(state);
      }
    };
    browser.storage.onChanged.addListener(handler);
    return () => browser.storage.onChanged.removeListener(handler);
  },
};

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Popup root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <ThemeProvider storage={themeStorage}>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
