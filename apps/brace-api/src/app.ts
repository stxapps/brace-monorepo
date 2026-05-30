import { Hono } from 'hono';

export const app = new Hono();

app.get('/', (c) => {
  return c.json({ message: 'Welcome to brace-api' });
});

app.get('/health', (c) => {
  return c.json({ status: 'ok' });
});
