import * as React from 'react';

// The brand mark. Both fills are THEME TOKENS rather than literals
// (`--brand-mark` body, `--brand-mark-dot` for the four knockout dots — declared
// in styles.css under `:root` and `.dark`), so the mark follows the theme: the
// near-black body would otherwise vanish into a dark background, leaving four
// floating dots. Light keeps the original artwork exactly; dark inverts.
//
// Done in CSS on purpose — the fills flip with the `.dark` class the pre-paint
// script already sets (docs/theme.md), so there's no `useTheme()` subscription,
// no re-render on a theme switch, and nothing client-only about the component
// (it still server-renders, and its markup is identical in both themes, so the
// hydration pass can't disagree).
export function BracemarkIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="39"
      height="44"
      viewBox="0 0 39 44"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M32.5 20C38.5 14 36.9039 3.04612 28.4424 1.31243e-05L4 9.7864e-06C1.99998 3.30168e-05 1.39481e-05 1.59523 1.39481e-05 4.00001L0 40C3.05176e-05 42 1.60073 44 4.00001 44H29C42.5576 39 39 23 32.5 20Z"
        className="fill-brand-mark"
      />
      <circle cx="11" cy="17" r="4" className="fill-brand-mark-dot" />
      <circle cx="23" cy="17" r="4" className="fill-brand-mark-dot" />
      <circle cx="23" cy="29" r="4" className="fill-brand-mark-dot" />
      <circle cx="11" cy="29" r="4" className="fill-brand-mark-dot" />
    </svg>
  );
}
