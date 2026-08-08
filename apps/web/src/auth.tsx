import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import { api, type User } from './api';

type AuthState = {
  user: User | null;
  restoring: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .me()
      .then((value) => active && setUser(value))
      .catch(() => undefined)
      .finally(() => active && setRestoring(false));
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => setUser(await api.login(email, password)),
    []
  );
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);
  const value = useMemo(
    () => ({ user, restoring, login, logout, setUser }),
    [user, restoring, login, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
