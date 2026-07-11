import { Landing } from '../components/landing';

// The public landing at `/`, outside both `(app)` and `(auth)` groups — the
// analogue of brace-web's `src/app/page.tsx`. Thin route: the presentational UI
// lives in `src/components/landing.tsx` (so its spec can colocate — files under
// the app root become routes), while navigation concerns stay here.
//
// TODO(auth): port brace-web's AuthedHomeRedirect — once @stxapps/expo-react
// ships auth state, bounce already-authenticated visitors from `/` to `/links`
// (return `<Redirect href="/links" />` when status === 'authenticated').
export default function Index() {
  return <Landing />;
}
