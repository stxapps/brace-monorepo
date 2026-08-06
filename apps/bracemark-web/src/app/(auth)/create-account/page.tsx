import type { Metadata } from 'next';

import { CreateAccountForm } from '@stxapps/web-ui/components/auth/create-account-form';
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@stxapps/web-ui/components/ui/card';
import { cn } from '@stxapps/web-ui/lib/utils';

import { AuthAltAction } from '../_components/auth-alt-action';

export const metadata: Metadata = { title: 'Create account' };

// Heading sized to the page step, matching /sign-in — see the note there.
//
// This page keeps a description where /sign-in drops one, because a signup has
// something to set expectations about: both halves of the line name a field this
// form will never show. There is no email address and no reset link, not as
// omissions but because the account has neither (docs/account.md — the secret IS
// the account), and that is exactly what makes the next screen hand the user a
// password they are told to save. Saying it before the ceremony starts turns that
// screen from a surprise into the thing they were just warned about. It beats the
// product line it replaced ("Start saving links to visit later") on the simple
// ground that whoever is on this page has already decided to sign up.
//
// It must also hold at EVERY step: this header is static while the form advances
// setup → confirm → recovery beneath it, so a line about the current field would
// go stale behind the user's back. This one describes the account, not the step —
// and it reads truest at the recovery step, where it says why that code exists.
export default function CreateAccountPage() {
  return (
    <>
      <CardHeader>
        <CardTitle className={cn('text-xl font-semibold tracking-tight')}>Create account</CardTitle>
        <CardDescription>
          No email address, no password reset — your password is the key to your links.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <CreateAccountForm />
      </CardContent>

      <AuthAltAction prompt="Already have an account?" href="/sign-in" action="Sign in" />
    </>
  );
}
