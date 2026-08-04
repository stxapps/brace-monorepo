import type { Metadata } from 'next';

import { PageShell } from '../../components/page-shell';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms you agree to when you use Bracemark.',
};

// TODO: the real terms. This route must have real content BEFORE store submission —
// both Apple and Google require a reachable terms URL on the listing, and the
// listings are what lock the bundle ID in (docs/brand.md).
export default function Page() {
  return (
    <PageShell title="Terms of Service">
      <p>TODO: the Terms of Service. Required before store submission.</p>
    </PageShell>
  );
}
