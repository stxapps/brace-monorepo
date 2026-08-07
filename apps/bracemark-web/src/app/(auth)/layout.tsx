import { BracemarkIcon } from '@stxapps/web-ui/components/icons/bracemark-icon';
import { Card } from '@stxapps/web-ui/components/ui/card';
import { cn } from '@stxapps/web-ui/lib/utils';

import { GuestGuard } from '@/components/guest-guard';

// Shared chrome for the auth routes (/create-account, /sign-in): a centered
// column on a full-height background. No nav — these pages are intentionally
// focused. Each page fills the card with its own CardHeader/Content/Footer.
// GuestGuard bounces already-authenticated visitors to /links — including right
// after create-account/sign-in, once setSession flips auth state.
//
// THE LOCKUP IS HERE FOR THE SAME REASON THE POPUP HAS ONE. These two routes are
// the only surface in bracemark-web rendered with no sidebar, so they are the only
// place the app never says its own name. A visitor lands here from three places
// that all drop them mid-flow — the marketing site's Get started, the browser
// extension's "Create an account", a bookmarked app.bracemark.com — and the tab
// title is the only other thing identifying the origin. Same mark size, same
// wordmark step and same gap as the browser extension's OptionsShell, so the two
// lockups are one lockup rendered twice rather than two that drift.
//
// The background is `--muted`/`--background`, NOT the `bg-gray-50 dark:bg-gray-900`
// this replaced. Those are raw palette values: gray-900 is blue-tinted (#111827)
// and the card on top of it is neutral (`--card`, chroma 0), so the dark theme
// showed a warm-neutral card floating on a navy page. The tokens can't disagree
// that way. They need the explicit dark half because `--muted` INVERTS relative to
// `--card` between themes: light muted (0.97) is darker than the card (1.0), dark
// muted (0.269) is LIGHTER than the card (0.205), so reusing it in dark would sink
// the card into the page. In dark the page drops to `--background` instead and the
// card lifts off it.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuestGuard>
      {/* Safe area is THIS surface's job now that bracemark-web has no blanket
          `.safe-area` div (inner-layout.tsx). It goes on the outer box, which
          owns the background and the height and carries no padding of its own:
          `safe-area` and `px-4` are both plain `padding` declarations, so sharing
          an element would make the winner a stylesheet-order detail that class
          order in JSX can't settle. The centering and the page padding stay one
          level in, where `px-4` also has to keep sitting OUTSIDE the `max-w-sm`
          column — moving it inside would cap the card at 352px instead of 384.
          A blanket is the right shape here, unlike on the app frames: this page
          is a centred card on a flat background, with no chrome reaching an edge
          (docs/safe-area.md, _applying safe area_).

          `min-h-dvh`, not `min-h-screen`, for the reason links/page.tsx spells
          out: `100vh` is the viewport with a mobile browser's URL bar retracted,
          so it overstates the height actually on screen. This page can scroll, so
          it merely centres the card slightly low rather than hiding anything —
          but there is no reason for one surface to measure the viewport
          differently from the rest. */}
      <div className={cn('flex min-h-dvh flex-col bg-muted safe-area dark:bg-background')}>
        <div className={cn('flex flex-1 flex-col items-center justify-center px-4 py-12')}>
          <div className={cn('flex w-full max-w-sm flex-col gap-6')}>
            <div className={cn('flex items-center gap-2.5')}>
              <BracemarkIcon className={cn('h-5 w-auto shrink-0')} aria-hidden="true" />
              <span className={cn('text-[0.9375rem] leading-none font-semibold tracking-tight')}>
                Bracemark
              </span>
            </div>

            <DogEaredCard>{children}</DogEaredCard>

            {/* Why the account behaves the way it does — no email field, no reset
              link, a password ceremony that insists you save something. Said once
              here, quietly, under both pages, so neither form has to re-argue it.
              Both halves are literal (docs/account.md, "a password-derived
              wallet"): the DEK never leaves the client, and the server stores a
              wrapped key it cannot unwrap. Don't inflate this into a marketing
              line — it's load-bearing context for the next thing the user does. */}
            <p className={cn('text-xs leading-5 text-balance text-muted-foreground')}>
              Your links are encrypted on your device before they're stored. Bracemark's servers
              never see your password.
            </p>
          </div>
        </div>
      </div>
    </GuestGuard>
  );
}

// The card, with the top-right corner taken off at 45° — the brand mark's own
// gesture (a page corner turned down to keep a place; see web-ui's
// bracemark-icon.tsx) performed at page scale. It is the one memorable thing on
// these two screens, which is why everything around it stays plain: this is a
// sign-in box, and a sign-in box that reaches for more than one idea reads as a
// phishing page rather than a designed one.
//
// SIZE. The mark cuts 11 of its 38 units (29%) and the browser extension's page
// tile cuts 12 of 44 (27%), but both of those are ~40px objects where the ratio IS
// the silhouette. On a 384px card the same ratio would be a 110px bevel — a shape,
// not a fold. 1.5rem is set against the card's own details instead: a step above
// the 1rem corner radius it sits beside, so it can't be misread as a heavier
// rounding, and level with the 1.5rem padding it aligns to.
//
// TWO ELEMENTS, because `clip-path` clips the ring off with everything else, so
// the hairline has to be a real filled layer underneath: the outer div is a 1px
// sheet of the card's ring colour, the Card is inset into it by that 1px, and both
// carry the same clip. `rounded-tr-none` on both is load-bearing — a 1rem radius
// under a 1.5rem cut leaves part of the arc outside the cut line, which lands as a
// nub on the diagonal rather than a clean corner.
//
// The shadow is a `filter`, not `shadow-*`, for the same clipping reason: a box
// shadow is painted outside the border box, so the clip erases it. `drop-shadow`
// traces the CLIPPED silhouette instead — the fold gets a shadow along its
// diagonal, which is what makes it read as a turned corner rather than a chipped
// one. It also carries the light theme, where a white card on `--muted` is a 3%
// step and the cut would otherwise be a hairline against near-identical fills.
// Deliberately weak (6%): the metaphor is a sheet of paper lying on a surface,
// not a floating dialog. In dark it lands on near-black and simply doesn't show,
// which is correct — there the card already separates by lightness.
function DogEaredCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn('rounded-2xl rounded-tr-none bg-foreground/10 p-px')}
      style={{ clipPath: DOG_EAR, filter: 'drop-shadow(0 2px 8px rgb(0 0 0 / 0.06))' }}
    >
      <Card className={cn('rounded-tr-none ring-0')} style={{ clipPath: DOG_EAR }}>
        {children}
      </Card>
    </div>
  );
}

const DOG_EAR = 'polygon(0 0, calc(100% - 1.5rem) 0, 100% 1.5rem, 100% 100%, 0 100%)';
