import { redirect } from 'next/navigation';

// Guard for the signed-in app (/links, /settings, …). Once auth is wired,
// resolve the session here (cookie / session id) and bounce unauthenticated
// visitors to /sign-in. Left permissive for now so the pages are viewable
// during development — flip `isSignedIn` to the real check.
async function getSession(): Promise<{ isSignedIn: boolean }> {
  // TODO: read the session from cookies and validate against brace-api.
  return { isSignedIn: true };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = await getSession();
  if (!isSignedIn) redirect('/sign-in');

  return <div className="min-h-screen">{children}</div>;
}
