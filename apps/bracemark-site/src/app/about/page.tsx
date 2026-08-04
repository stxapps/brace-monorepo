import type { Metadata } from 'next';

import { PageShell } from '../../components/page-shell';

export const metadata: Metadata = {
  title: 'About',
  description: 'What Bracemark is, who makes it, and why it encrypts everything.',
};

// TODO: real copy. The shape below is a placeholder so the route, the nav entry, and
// the metadata exist; the story it tells (encryption-first bookmarking, the Brace.to
// lineage) is drafted in docs/brand.md and docs/legacy-brace-to.md.
export default function Page() {
  return (
    <PageShell title="About Bracemark">
      <p>
        Bracemark is a bookmark manager with privacy at heart. Your links are encrypted on your
        device, and only you hold the key that decrypts them.
      </p>
      <p>TODO: the full about copy.</p>
    </PageShell>
  );
}
