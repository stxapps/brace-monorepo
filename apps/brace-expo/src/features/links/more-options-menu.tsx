// The overflow menu behind the topbar's ⋯ button — the expo port of brace-web's
// MoreOptionsMenu (`(app)/links/_components/more-options-menu.tsx`, the
// canonical doc): account-
// and session-level actions that don't warrant their own topbar slot, with the
// same phase-adaptive Sync entry and the error dot on the trigger — still the
// links screen's only always-visible sync-error surface (pull-to-refresh gives
// the gesture but no error affordance; the full status card lives in Settings →
// Data when it's ported). Only errors get the dot: a spinner there would flicker
// on every edit's sub-second cycle. Divergences here:
//
//  - Selecting Sync CLOSES the menu (web keeps it open so the Syncing… → settled
//    transition is the click's feedback) — holding a native dropdown open works
//    against the platform idiom, so the trigger's error dot (or its absence) is
//    the outcome surface instead. requestSync coalesces, so re-taps are safe.
//  - Web's Bulk edit lives OUTSIDE the menu (its own topbar button); here it
//    joins the menu when the bulk-edit feature is ported (selection state, the
//    action toolbar, and the mutation hooks don't exist on expo yet).
//  - Support opens the brace-web page in the system browser — the web app's
//    origin comes from EXPO_PUBLIC_WEB_URL (inlined by Metro from `.env.<mode>`,
//    same convention as lib/api-client.ts).
//  - No InitialSyncGate on this platform yet ((app)/_layout's TODO), so unlike
//    web, storeStatus CAN be pre-'ready' here; those phases ('checking' /
//    'initial-syncing' / 'initial-error') just show the plain Sync label until
//    the gate lands and owns them.

import { Linking, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CircleAlert, LifeBuoy, LogOut, MoreHorizontal, RefreshCw, Settings } from 'lucide-react-native';

import { useSignOut, useSync } from '@stxapps/expo-react';
import { getSyncPhase } from '@stxapps/shared';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Icon } from '../../components/ui/icon';
import { Text } from '../../components/ui/text';

const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
if (!webUrl) throw new Error('EXPO_PUBLIC_WEB_URL is not set');

export function MoreOptionsMenu() {
  const { storeStatus, bgSyncStatus, requestSync } = useSync();
  const signOut = useSignOut();
  const router = useRouter();
  const phase = getSyncPhase(storeStatus, bgSyncStatus);
  const syncError = phase === 'cycle-error';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Pressable
          aria-label={syncError ? 'More options (sync failed)' : 'More options'}
          className="relative size-10 items-center justify-center rounded-md"
        >
          <Icon as={MoreHorizontal} className="text-muted-foreground size-5" />
          {syncError && (
            <View
              aria-hidden
              className="bg-destructive absolute top-1.5 right-1.5 size-1.5 rounded-full"
            />
          )}
        </Pressable>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onPress={requestSync}>
          {syncError ? (
            <>
              <Icon as={CircleAlert} className="text-destructive size-4" />
              <Text>Sync failed — Retry</Text>
            </>
          ) : (
            <>
              <Icon as={RefreshCw} className="size-4" />
              <Text>{phase === 'syncing' ? 'Syncing…' : 'Sync'}</Text>
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onPress={() => router.push('/settings')}>
          <Icon as={Settings} className="size-4" />
          <Text>Settings</Text>
        </DropdownMenuItem>
        <DropdownMenuItem onPress={() => void Linking.openURL(`${webUrl}/support`)}>
          <Icon as={LifeBuoy} className="size-4" />
          <Text>Support</Text>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* useSignOut: server revocation (best-effort), then the local wipe —
            never the bare endSession primitive, which only drops the session. */}
        <DropdownMenuItem
          variant="destructive"
          disabled={signOut.isPending}
          onPress={() => signOut.mutate()}
        >
          <Icon as={LogOut} className="size-4" />
          <Text>Sign out</Text>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
