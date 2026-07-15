'use client';

import * as React from 'react';

import { PASSWORD_MIN_GUESSES_LOG10 } from '@stxapps/shared';
import { cn } from '@stxapps/web-ui/lib/utils';

// The create-account entropy gate (docs/account.md). Callers gate on the returned
// `guessesLog10` against PASSWORD_MIN_GUESSES_LOG10 (10^18 ≈ 60 bits) on the
// TYPED-your-own path only; the generated passphrase is ~77 bits by construction and
// bypasses this entirely.
//
// Do NOT gate on `score`. zxcvbn's 0–4 score is a 5-bucket label over the same
// guess estimate, and its top bucket is open-ended ("guesses >= 1e10" ≈ 33 bits) —
// so score 4 spans `Summer2026Brace!` (~35 bits) through a 7-word passphrase
// (~121 bits). It's a display signal, not a policy one. See the constant's comment
// in `shared` `auth/credentials.ts`.
//
// zxcvbn is heavy (~400 KB with its dictionaries), so it's DYNAMICALLY imported
// on first use — it never lands in the initial auth-route bundle. Until it loads,
// both outputs are null and the caller keeps submit disabled (never gate-open before
// the estimator is ready).

// The meter's passing band. Display-only and deliberately NOT exported: the gate is
// guessesLog10, and an exported score threshold is exactly the footgun that let a
// ~27-bit password through before.
const PASSING_SCORE = 4;

type Estimate = { score: number; guessesLog10: number };
type ScoreFn = (password: string, userInputs: string[]) => Estimate;

// Lazily load zxcvbn + its common language pack once, then score `password`
// (penalizing `userInputs` — e.g. the username — so a username-derived password
// scores low). Returns { score: 0–4 | null, guessesLog10: number | null, ready }.
// Both estimates are null while loading or when the password is empty.
//
// `guessesLog10` is the raw, uncapped estimate — the value callers gate on.
// `score` is for the meter only, and is clamped to sub-passing whenever the password
// is below `minLength` OR below PASSWORD_MIN_GUESSES_LOG10, so the meter can never
// show a green "Strong" while the gate blocks submit ("green meter but disabled
// button"). zxcvbn itself can't be told either floor — it reports estimated guess
// counts and buckets them — so we do it here.
//
// Pass the CANONICAL password so both the length and the estimate match what
// actually derives the KEK.
export function usePasswordStrength(
  password: string,
  userInputs: string[] = [],
  minLength = 0,
): { score: number | null; guessesLog10: number | null; ready: boolean } {
  const [scoreFn, setScoreFn] = React.useState<ScoreFn | null>(null);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const [core, common] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
      ]);
      core.zxcvbnOptions.setOptions({
        dictionary: { ...common.dictionary },
        graphs: common.adjacencyGraphs,
      });
      if (alive) {
        setScoreFn(() => (pw: string, inputs: string[]) => {
          const r = core.zxcvbn(pw, inputs);
          return { score: r.score, guessesLog10: r.guessesLog10 };
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Join userInputs to a stable string key so a fresh [username] array each render
  // doesn't force a recompute when nothing meaningful changed.
  const inputsKey = userInputs.join(' ');
  return React.useMemo(() => {
    if (!scoreFn || !password) {
      return { score: null, guessesLog10: null, ready: scoreFn !== null };
    }
    const raw = scoreFn(password, inputsKey ? inputsKey.split(' ').filter(Boolean) : []);
    // Clamp the DISPLAY score to sub-passing while either floor blocks submit, so the
    // meter and the gate stay one signal. (This makes label 3 "Good" unreachable by
    // design: below the bar the meter tops out at "Fair", at the bar it's "Strong".)
    const blocked =
      password.length < minLength || raw.guessesLog10 < PASSWORD_MIN_GUESSES_LOG10;
    const score = blocked ? Math.min(raw.score, PASSING_SCORE - 2) : raw.score;
    return { score, guessesLog10: raw.guessesLog10, ready: true };
  }, [scoreFn, password, inputsKey, minLength]);
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

// A four-segment meter with a text label. Renders nothing until there's a score
// to show (empty password / estimator still loading).
export function PasswordStrengthMeter({ score }: { score: number | null }) {
  if (score === null) return null;

  // Segments 1–4 fill as score climbs (score 0 fills the first, in red). Color
  // steps destructive → amber → primary, and only PASSING_SCORE reads as passing —
  // the hook has already clamped anything the gate blocks below that.
  const tone =
    score >= PASSING_SCORE ? 'bg-primary' : score === 2 ? 'bg-amber-500' : 'bg-destructive';
  const filled = score + 1; // score 0 → 1 segment lit

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn('h-1.5 flex-1 rounded-full', i < filled ? tone : 'bg-border')}
          />
        ))}
      </div>
      <span
        className={cn(
          'w-16 shrink-0 text-right text-xs',
          score >= PASSING_SCORE ? 'text-muted-foreground' : 'text-destructive',
        )}
      >
        {LABELS[score]}
      </span>
    </div>
  );
}
