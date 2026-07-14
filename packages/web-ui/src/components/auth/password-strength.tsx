'use client';

import * as React from 'react';

import { cn } from '@stxapps/web-ui/lib/utils';

// The create-account entropy gate (docs/account.md — "STATUS: add a strength
// estimator … with a hard floor"). zxcvbn scores 0–4; we require ≥3 ("good") to
// enable submit on the TYPED-your-own path only. The generated passphrase is
// ~77 bits by construction and bypasses this entirely.
//
// zxcvbn is heavy (~400 KB with its dictionaries), so it's DYNAMICALLY imported
// on first use — it never lands in the initial auth-route bundle. Until it loads,
// score is null and the caller keeps submit disabled (never gate-open before the
// estimator is ready).
export const PASSWORD_MIN_STRENGTH_SCORE = 3;

type ScoreFn = (password: string, userInputs: string[]) => number;

// Lazily load zxcvbn + its common language pack once, then score `password`
// (penalizing `userInputs` — e.g. the username — so a username-derived password
// scores low). Returns { score: 0–4 | null, ready }. score is null while loading
// or when the password is empty.
//
// `minLength` folds the hard length floor INTO the strength signal: below it, the
// score is capped one below the pass threshold, so the meter never shows a green
// "Good/Strong" for a too-short password the min-length gate will reject anyway
// (no "green meter but disabled button" contradiction). zxcvbn itself can't be
// told "not strong under N chars" — it scores by estimated guess count — so we do
// it here. Pass the CANONICAL password so the length matches what derives the KEK.
export function usePasswordStrength(
  password: string,
  userInputs: string[] = [],
  minLength = 0,
): { score: number | null; ready: boolean } {
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
      if (alive) setScoreFn(() => (pw: string, inputs: string[]) => core.zxcvbn(pw, inputs).score);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Join userInputs to a stable string key so a fresh [username] array each render
  // doesn't force a recompute when nothing meaningful changed.
  const inputsKey = userInputs.join(' ');
  const score = React.useMemo(() => {
    if (!scoreFn || !password) return null;
    const raw = scoreFn(password, inputsKey ? inputsKey.split(' ').filter(Boolean) : []);
    // Cap below the pass threshold until the length floor is met, so a short
    // password can't display as passing while the min-length gate blocks it.
    return password.length < minLength ? Math.min(raw, PASSWORD_MIN_STRENGTH_SCORE - 1) : raw;
  }, [scoreFn, password, inputsKey, minLength]);

  return { score, ready: scoreFn !== null };
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

// A four-segment meter with a text label. Renders nothing until there's a score
// to show (empty password / estimator still loading).
export function PasswordStrengthMeter({ score }: { score: number | null }) {
  if (score === null) return null;

  // Segments 1–4 fill as score climbs (score 0 fills the first, in red). Color
  // steps from destructive → good, matching the ≥3 gate.
  const tone =
    score >= 3 ? 'bg-primary' : score === 2 ? 'bg-amber-500' : 'bg-destructive';
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
          score >= 3 ? 'text-muted-foreground' : 'text-destructive',
        )}
      >
        {LABELS[score]}
      </span>
    </div>
  );
}
