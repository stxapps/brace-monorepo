'use client';

// The main pane: reads the paginated link query once and hands it to whichever
// layout the topbar selected. Each layout owns its own scroll/virtualization, so
// this is a thin switch — it's the single place the data hook meets the layouts.

import { useLinksPage } from '../_contexts/page-provider';
import { useLinks } from '../_hooks/use-links';
import { CardLayout } from '../_layouts/card-layout';
import { ListLayout } from '../_layouts/list-layout';
import type { LinkLayoutProps } from '../_layouts/shared';
import { TableLayout } from '../_layouts/table-layout';

const LAYOUTS: Record<string, (props: LinkLayoutProps) => React.ReactNode> = {
  list: ListLayout,
  card: CardLayout,
  table: TableLayout,
};

export function Main() {
  const { layoutMode } = useLinksPage();
  const { links, pinnedCount, hasMore, showMore, isLoading, hasPending, applyPending } = useLinks();

  const Layout = LAYOUTS[layoutMode];

  return (
    <main className="min-h-0 flex-1">
      <Layout
        links={links}
        pinnedCount={pinnedCount}
        hasMore={hasMore}
        showMore={showMore}
        isLoading={isLoading}
        hasPending={hasPending}
        applyPending={applyPending}
      />
    </main>
  );
}
