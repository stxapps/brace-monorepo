import type { Metadata } from 'next';

import { PageShell } from '../../components/page-shell';

export const metadata: Metadata = {
  title: 'Blog',
  description: 'Product news and writing from the people who make Bracemark.',
};

// TODO: the index route only. Posts need the same content pipeline decision as
// /docs — see the note in ../docs/page.tsx. Whatever it is, both should use it.
export default function Page() {
  return (
    <PageShell title="Blog">
      <p>TODO: posts, and the content pipeline that renders them.</p>
    </PageShell>
  );
}
