import { Hono } from 'hono';

import { shared } from '@stxapps/shared';

export const app = new Hono();

app.get('/', (c) => {
  shared();
  return c.json({ message: 'Welcome to brace-api' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});
