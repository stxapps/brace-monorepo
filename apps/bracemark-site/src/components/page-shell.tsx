import { cn } from '@stxapps/web-ui/lib/utils';

// The single-column wrapper every non-landing page uses. The landing page opts out
// (it's a full-width hero), which is why this is a component rather than a nested
// layout under a route group.
export function PageShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className={cn('mx-auto max-w-3xl px-4 pt-12 pb-8 md:px-6 lg:px-8')}>
      <h1 className={cn('text-3xl leading-tight font-bold text-gray-900 lg:text-4xl')}>{title}</h1>
      <div className={cn('mt-6 space-y-4 text-base text-gray-600')}>{children}</div>
    </article>
  );
}
