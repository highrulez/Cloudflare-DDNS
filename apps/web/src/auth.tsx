import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type User } from './api';

type LoginResult = { mfaRequired: true } | { mfaRequired: false; user: User };

type AuthValue = {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, turnstileToken: string) => Promise<LoginResult>;
  verifyMfa: (data: { code?: string; recoveryCode?: string }) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api
      .me()
      .then(({ user }) => setUser(user))
      .catch((error) => {
        // Unauthenticated bootstrap is normal — render Login, never crash.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return;
        if (import.meta.env.DEV) console.error(error);
      })
      .finally(() => setLoading(false));
  }, []);
  const login = async (username: string, password: string, turnstileToken: string) => {
    const result = await api.login(username, password, turnstileToken);
    if (result.mfaRequired) return { mfaRequired: true as const };
    setUser(result.user);
    return { mfaRequired: false as const, user: result.user };
  };
  const verifyMfa = async (data: { code?: string; recoveryCode?: string }) => {
    const result = await api.verifyMfa(data);
    setUser(result.user);
    return result.user;
  };
  const logout = async () => {
    await api.logout();
    setUser(null);
  };
  return (
    <AuthContext.Provider value={{ user, loading, login, verifyMfa, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
