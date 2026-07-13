import { AuthedHomeRedirect } from '../components/authed-home-redirect';
import { Landing } from '../components/landing';

// The public landing at `/`, outside both `(app)` and `(auth)` groups — the
// analogue of brace-web's `src/app/page.tsx`. Thin route: the presentational UI
// lives in `src/components/landing.tsx` (so its spec can colocate — files under
// the app root become routes), while navigation concerns stay here.
//
// AuthedHomeRedirect (mirroring brace-web's page.tsx) bounces already-authenticated
// visitors from `/` to `/links` off the AuthProvider in the root `_layout`; it
// renders null for guests, so the landing hero shows unaffected.
export default function Index() {
  return (
    <>
      <AuthedHomeRedirect />
      <Landing />
    </>
  );
}
