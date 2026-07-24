import Svg, { Circle, Path } from 'react-native-svg';

// The brace mark — the RN port of web-ui's `components/icons/brace-icon.tsx`
// (byte-identical path/circles + viewBox). The fills are the FIXED brand colors,
// same as web: the near-black body reads on the light default; on dark the four
// white dots carry it. Kept in-app (not a package) since brace-expo is the only
// expo surface, like the react-native-reusables copies. Defaults to web's `h-6`
// render size (24px tall), preserving the 39:44 viewBox aspect.
export function BraceIcon({ height = 24 }: { height?: number }) {
  return (
    <Svg width={(height * 39) / 44} height={height} viewBox="0 0 39 44" fill="none">
      <Path
        d="M32.5 20C38.5 14 36.9039 3.04612 28.4424 1.31243e-05L4 9.7864e-06C1.99998 3.30168e-05 1.39481e-05 1.59523 1.39481e-05 4.00001L0 40C3.05176e-05 42 1.60073 44 4.00001 44H29C42.5576 39 39 23 32.5 20Z"
        fill="#1A202C"
      />
      <Circle cx="11" cy="17" r="4" fill="white" />
      <Circle cx="23" cy="17" r="4" fill="white" />
      <Circle cx="23" cy="29" r="4" fill="white" />
      <Circle cx="11" cy="29" r="4" fill="white" />
    </Svg>
  );
}
