'use client';

import { Button } from '@stxapps/web-ui/components/ui/button';
import { cn } from '@stxapps/web-ui/lib/utils';

import { useSaveLink } from './use-save-link';

export function SaveLinkForm() {
  const saveLink = useSaveLink();

  return (
    <Button
      variant="default"
      className={cn('')}
      onClick={() => saveLink.mutate()}
      disabled={saveLink.isPending}
    >
      Save Link
    </Button>
  );
}
