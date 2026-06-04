import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { shared } from '@stxapps/shared';

import { authRoutes } from './routes/auth';

export const app = new Hono();

// Browser clients are cross-origin (brace-web dev runs on :4000, the extension
// from its own origin), so allow CORS. Tighten the origin allow-list before prod.
app.use(
  '*',
  cors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4000').split(','),
    credentials: true,
  }),
);

app.get('/', (c) => {
  shared();
  return c.json({ message: 'Welcome to brace-api' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});

app.route('/', authRoutes);
