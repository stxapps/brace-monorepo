import type { Metadata } from 'next';

import { PageShell } from '../../components/page-shell';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'What Bracemark stores, what it cannot read, and what it never collects.',
};

// TODO: the real policy. This route must have real content BEFORE store submission —
// every store requires a reachable privacy-policy URL. The substance is already
// decided and written down: the server is a blind sync broker that only ever sees
// ciphertext (docs/local-first-sync.md, docs/architecture.md — bracemark-extractor is
// the one component that fetches user URLs, and it holds no key and persists nothing).
export default function Page() {
  return (
    <PageShell title="Privacy Policy">
      <p>TODO: the Privacy Policy. Required before store submission.</p>
    </PageShell>
  );
}
