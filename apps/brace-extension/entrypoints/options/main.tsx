import React from 'react';
import ReactDOM from 'react-dom/client';

import { Providers } from '../popup/providers.tsx';
import App from './App.tsx';

import '../popup/style.css';

import { themeStorage } from '@/utils/theme-storage';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Options root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Providers themeStorage={themeStorage}>
      <App />
    </Providers>
  </React.StrictMode>,
);
