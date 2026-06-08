'use client';

import { Button } from '@stxapps/web-ui/components/ui/button';
import { cn } from '@stxapps/web-ui/lib/utils';

import { useSignOut } from './use-sign-out';

export function SignOutButton() {
  const signOut = useSignOut();

  return (
    <Button
      variant="outline"
      className={cn('bg-background hover:bg-input/30')}
      onClick={() => signOut.mutate()}
      disabled={signOut.isPending}
    >
      Sign out
    </Button>
  );
}
