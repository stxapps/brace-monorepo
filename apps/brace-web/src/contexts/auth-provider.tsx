'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { clearSession, loadSession, saveSession, type SessionRecord } from '../data/session-store';

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
  // Drop the local session. TODO: also revoke server-side once that endpoint lands.
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
