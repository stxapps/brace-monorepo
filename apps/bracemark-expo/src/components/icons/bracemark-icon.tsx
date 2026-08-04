import { type ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useCSSVariable } from 'uniwind';

// The bracemark mark — the RN port of web-ui's `components/icons/bracemark-icon.tsx`
// (byte-identical path/circles + viewBox). Both fills are THEME TOKENS rather
// than literals (`--color-brand-mark` body, `--color-brand-mark-dot` for the
// four knockout dots), so the mark follows the theme: the near-black body would
// otherwise vanish into a dark background, leaving four floating dots. Light
// keeps the original artwork exactly; dark inverts. Kept in-app (not a package)
// since bracemark-expo is the only expo surface, like the react-native-reusables
// copies. Defaults to web's `h-6` render size (24px tall), preserving the 39:44
// viewBox aspect.
//
// react-native-svg takes fills as PROPS, not classNames, so the tokens come from
// the active Uniwind theme via `useCSSVariable` — the same mechanism, and the
// same reasoning, as `components/ui/switch.tsx`: it re-reads when
// `Uniwind.setTheme` fires (components/theme-provider.tsx), and reading the vars
// beats a `useTheme()` branch over hardcoded hexes, which would duplicate
// global.css and drag the settings data layer into any spec that renders the
// mark. Only a native build proves they resolve — jest mocks `uniwind`, and the
// hook returns undefined there.
export function BracemarkIcon({ height = 24 }: { height?: number }) {
  const [mark, dot] = useCSSVariable(['--color-brand-mark', '--color-brand-mark-dot']);

  return (
    <Svg width={(height * 39) / 44} height={height} viewBox="0 0 39 44" fill="none">
      <Path
        d="M32.5 20C38.5 14 36.9039 3.04612 28.4424 1.31243e-05L4 9.7864e-06C1.99998 3.30168e-05 1.39481e-05 1.59523 1.39481e-05 4.00001L0 40C3.05176e-05 42 1.60073 44 4.00001 44H29C42.5576 39 39 23 32.5 20Z"
        fill={asColor(mark)}
      />
      <Circle cx="11" cy="17" r="4" fill={asColor(dot)} />
      <Circle cx="23" cy="17" r="4" fill={asColor(dot)} />
      <Circle cx="23" cy="29" r="4" fill={asColor(dot)} />
      <Circle cx="11" cy="29" r="4" fill={asColor(dot)} />
    </Svg>
  );
}

// `useCSSVariable` is typed `string | number | undefined` because on native
// Uniwind can hand back an already-processed color int — RN accepts that at
// runtime, but `ColorValue` (string | OpaqueColorValue) doesn't admit it. The
// same cast as `components/ui/switch.tsx`.
const asColor = (value: string | number | undefined) => value as ColorValue | undefined;
