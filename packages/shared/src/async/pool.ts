// Run `fn` over `items` with at most `limit` in flight — a minimal concurrency pool
// (no dep) that bounds the work in flight without serializing everything: a large first
// sync's socket count, or an extraction batch's image-proxy fetches, stay capped. `fn`
// is expected to swallow its own per-item failures; the workers just drain the shared
// queue, so the pool itself never rejects mid-drain.
//
// Lives in `shared` (platform-agnostic — only Promise/Array, no web/worker APIs) so every
// app pools the same way: brace-web/brace-extension's sync engine + server extraction
// today, and the future brace-expo, instead of each re-spelling the worker loop.
export async function mapLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await fn(item);
    }
  });
  await Promise.all(workers);
}
