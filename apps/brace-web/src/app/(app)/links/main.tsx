'use client';

// The main pane: reads the paginated link query once and hands it to whichever
// layout the topbar selected. Each layout owns its own scroll/virtualization, so
// this is a thin switch — it's the single place the data hook meets the layouts.

import { useLinks } from './hooks/use-links';
import { CardLayout } from './layouts/card-layout';
import { ListLayout } from './layouts/list-layout';
import type { LinkLayoutProps } from './layouts/shared';
import { TableLayout } from './layouts/table-layout';
import { useLinksPage } from './links-page-provider';

const LAYOUTS: Record<string, (props: LinkLayoutProps) => React.ReactNode> = {
  list: ListLayout,
  card: CardLayout,
  table: TableLayout,
};

export function Main() {
  const { layoutMode } = useLinksPage();
  const { links, hasMore, showMore, isLoading } = useLinks();

  const Layout = LAYOUTS[layoutMode];

  return (
    <main className="min-h-0 flex-1">
      <Layout links={links} hasMore={hasMore} showMore={showMore} isLoading={isLoading} />
    </main>
  );
}
