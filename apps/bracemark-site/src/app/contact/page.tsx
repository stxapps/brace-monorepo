import type { Metadata } from 'next';

import { PageShell } from '../../components/page-shell';
import { SUPPORT_EMAIL } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach the people who make Bracemark.',
};

// A mailto, deliberately, not a form: this app is a static export with no server, so
// a contact form would need a third-party endpoint — a new external dependency and a
// new place user data lands, which is a decision worth making explicitly rather than
// by default. See docs/deployment.md.
export default function Page() {
  return (
    <PageShell title="Contact">
      <p>TODO: real contact details.</p>
      <p>
        Until then, email <span>{SUPPORT_EMAIL}</span>.
      </p>
    </PageShell>
  );
}
