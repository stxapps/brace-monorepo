import type { Metadata } from 'next';

import { PageShell } from '../../components/page-shell';
import { SUPPORT_EMAIL } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with Bracemark.',
};

// TODO: real support content (FAQ + the escalation path). Like /terms and /privacy,
// a reachable support URL is a store-listing requirement.
export default function Page() {
  return (
    <PageShell title="Support">
      <p>TODO: the support FAQ.</p>
      <p>
        Until then, email <span>{SUPPORT_EMAIL}</span>.
      </p>
    </PageShell>
  );
}
