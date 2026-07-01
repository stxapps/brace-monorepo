import React from 'react';
import ReactDOM from 'react-dom/client';

import { Providers } from '../popup/providers.tsx';
import App from './App.tsx';

import '../popup/style.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Options root element #root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Providers>
      <App />
    </Providers>
  </React.StrictMode>,
);
