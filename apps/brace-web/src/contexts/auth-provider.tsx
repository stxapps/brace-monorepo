'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  clearSession,
  loadSession,
  onSessionInvalid,
  saveSession,
  type SessionRecord,
} from '../data/session-store';

// App-level auth state. Web-only (like the session store it reads): account
// creation / sign-in happen on the web app, and the extension inherits the
// session out of storage rather than running this. Only `username`/`status` enter
// React state — the bearer token and the non-extractable encryptionKey stay in the
// session store (read where needed via getToken/getSession), keeping key material
// out of the component tree.

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  status: AuthStatus;
  isAuthenticated: boolean;
  username: string | null;
  // Adopt a freshly created / signed-in session: persist it and flip to authed.
  setSession: (record: SessionRecord) => Promise<void>;
  // Drop the LOCAL session only. Server-side revocation lives in the user-driven
  // useSignOut hook (which POSTs sign-out, then calls this); this stays local so
  // it can also serve the onSessionInvalid path, where the token is already dead.
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // 'loading' until hydration resolves, so the UI can hold off on auth-gated
  // decisions instead of flashing a signed-out state. Matches on server + first
  // client render (both 'loading'), so there's no hydration mismatch.
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [username, setUsername] = useState<string | null>(null);

  // Hydrate from IndexedDB once on mount. An expired session is cleared and
  // treated as signed-out.
  useEffect(() => {
    let active = true;
    loadSession()
      .then((s) => {
        if (!active) return;
        if (s && s.expiresAt > Date.now()) {
          setUsername(s.username);
          setStatus('authenticated');
        } else {
          if (s) void clearSession();
          setUsername(null);
          setStatus('unauthenticated');
        }
      })
      .catch(() => {
        if (active) setStatus('unauthenticated');
      });
    return () => {
      active = false;
    };
  }, []);

  const setSession = useCallback(async (record: SessionRecord) => {
    await saveSession(record);
    setUsername(record.username);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setUsername(null);
    setStatus('unauthenticated');
  }, []);

  // React to the api client detecting an invalid session (server 401, or a
  // mid-session token expiry) by dropping to signed-out. AuthGuard then bounces
  // protected routes to /sign-in. The ref collapses a burst of concurrent failing
  // requests into a single signOut — set synchronously before the async call, so
  // it doesn't lean on clearSession's internal timing — and resets after so a
  // later re-login can be invalidated again.
  const signingOut = useRef(false);
  useEffect(
    () =>
      onSessionInvalid(() => {
        if (signingOut.current) return;
        signingOut.current = true;
        void signOut().finally(() => {
          signingOut.current = false;
        });
      }),
    [signOut],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ status, isAuthenticated: status === 'authenticated', username, setSession, signOut }),
    [status, username, setSession, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
