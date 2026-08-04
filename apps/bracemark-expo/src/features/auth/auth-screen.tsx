import { type ReactNode } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { Text } from '../../components/ui/text';

// Shared chrome for the auth screens (/create-account, /sign-in) — the native
// merge of bracemark-web's `(auth)/layout.tsx` (the centered Card on a full-height
// background) and each page's CardHeader/Content/Footer sections. No nav —
// these screens are intentionally focused. The route group's `_layout.tsx`
// keeps only the GuestGuard + Stack; this component owns the visuals, so it
// lives outside `src/app/` (every file under the app root becomes a route).
//
// Mobile-only concerns web's layout doesn't have: the scroll view keeps long
// content (the ceremony's recovery step) reachable on small screens, and it's
// keyboard-controller's KeyboardAwareScrollView because the keyboard overlays
// the window on BOTH platforms now — with edge-to-edge (enforced on
// Android 15+) `adjustResize` no longer resizes the window, and RN core only
// emits keyboard events without moving anything. It scrolls the focused field
// clear of the keyboard, frame-synced with the keyboard animation
// (KeyboardProvider lives in the root `_layout.tsx`). `keyboardShouldPersistTaps`
// lets a tap on a button land while the keyboard is up instead of only
// dismissing it.

// Both are composites (not core hosts), so they need Uniwind's HOC to accept
// `className` — which also maps KeyboardAwareScrollView's
// `contentContainerClassName` onto `contentContainerStyle`.
const StyledSafeAreaView = withUniwind(SafeAreaView);
const StyledKeyboardAwareScrollView = withUniwind(KeyboardAwareScrollView);

export function AuthScreen({
  title,
  description,
  footer,
  children,
}: {
  title: string;
  description: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <StyledSafeAreaView className="flex-1 bg-secondary dark:bg-background">
      <StyledKeyboardAwareScrollView
        contentContainerClassName="grow justify-center px-4 py-12"
        keyboardShouldPersistTaps="handled"
        bottomOffset={16}
      >
        <View className="w-full max-w-sm self-center rounded-xl border border-border bg-card py-6 shadow-sm">
          <View className="gap-1.5 px-6">
            <Text role="heading" className="font-semibold text-card-foreground">
              {title}
            </Text>
            <Text className="text-sm text-muted-foreground">{description}</Text>
          </View>

          <View className="mt-6 px-6">{children}</View>

          {footer ? <View className="mt-6 flex-row justify-center px-6">{footer}</View> : null}
        </View>
      </StyledKeyboardAwareScrollView>
    </StyledSafeAreaView>
  );
}
