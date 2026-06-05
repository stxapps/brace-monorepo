import { app } from './app';

// Cloudflare Workers entry. The Workers runtime calls `fetch(request, env, ctx)`
// on the default export, and Hono's `app` is exactly that handler. This is the
// only entry — brace-api runs solely on Workers (no Node entry), so config
// always comes from `c.env` (wrangler.jsonc vars/bindings); see app.ts.
export default app;
