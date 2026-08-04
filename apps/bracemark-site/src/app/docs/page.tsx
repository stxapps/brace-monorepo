import type { Metadata } from 'next';

import { PageShell } from '../../components/page-shell';

export const metadata: Metadata = {
  title: 'Docs',
  description: 'How to use Bracemark.',
};

// TODO: this is the route, not the content system. Docs and blog both need a
// content pipeline (MDX under `src/content/`, or a `[slug]` route reading a data
// dir), and picking one is a real decision — it drags in @next/mdx or a markdown
// runtime, a frontmatter schema, and a syntax highlighter. Deliberately not chosen
// here so the choice is made on purpose rather than inherited from a scaffold.
//
// NOTE this is USER documentation (how to use the app), a different thing from the
// repo's `docs/` folder, which is the internal design record (docs/architecture.md).
export default function Page() {
  return (
    <PageShell title="Docs">
      <p>TODO: user documentation, and the content pipeline that renders it.</p>
    </PageShell>
  );
}
