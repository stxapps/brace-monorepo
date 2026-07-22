import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

import { Text } from '../../components/ui/text';

// Shared chrome for the auth screens (/create-account, /sign-in) — the native
// merge of brace-web's `(auth)/layout.tsx` (the centered Card on a full-height
// background) and each page's CardHeader/Content/Footer sections. No nav —
// these screens are intentionally focused. The route group's `_layout.tsx`
// keeps only the GuestGuard + Stack; this component owns the visuals, so it
// lives outside `src/app/` (every file under the app root becomes a route).
//
// Mobile-only concerns web's layout doesn't have: the ScrollView keeps long
// content (the ceremony's recovery step) reachable on small screens, and
// KeyboardAvoidingView keeps the focused field visible above the keyboard
// (padding on iOS, where the keyboard overlays; Android resizes the window
// itself). `keyboardShouldPersistTaps` lets a tap on a button land while the
// keyboard is up instead of only dismissing it.

// Core hosts (KeyboardAvoidingView, ScrollView — including
// `contentContainerClassName`) accept `className` directly; SafeAreaView is a
// composite from react-native-safe-area-context, so it needs Uniwind's HOC.
const StyledSafeAreaView = withUniwind(SafeAreaView);

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
    <StyledSafeAreaView className="bg-secondary flex-1 dark:bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerClassName="grow justify-center px-4 py-12"
          keyboardShouldPersistTaps="handled"
        >
          <View className="bg-card border-border w-full max-w-sm self-center rounded-xl border py-6 shadow-sm">
            <View className="gap-1.5 px-6">
              <Text role="heading" className="text-card-foreground font-semibold">
                {title}
              </Text>
              <Text className="text-muted-foreground text-sm">{description}</Text>
            </View>

            <View className="mt-6 px-6">{children}</View>

            {footer ? <View className="mt-6 flex-row justify-center px-6">{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </StyledSafeAreaView>
  );
}
