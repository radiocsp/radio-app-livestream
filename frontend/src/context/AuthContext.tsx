import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface AuthUser {
  id: string;
  username: string;
  role: 'admin' | 'viewer';
  lastLogin?: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (username: string, password: string, remember?: boolean) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'rss_token';
const REFRESH_KEY = 'rss_refresh';
const USER_KEY = 'rss_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    try {
      const stored = sessionStorage.getItem(USER_KEY) || localStorage.getItem(USER_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  const [token, setToken] = useState<string | null>(() => {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
  });

  const [isLoading, setIsLoading] = useState(false);

  // Persist state helper
  const persist = useCallback((newToken: string, newUser: AuthUser, remember: boolean) => {
    const storage = remember ? localStorage : sessionStorage;
    // Clear other storage
    if (remember) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }
    storage.setItem(TOKEN_KEY, newToken);
    storage.setItem(USER_KEY, JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  }, []);

  // Token auto-refresh before expiry
  useEffect(() => {
    if (!token) return;

    let timer: ReturnType<typeof setTimeout>;

    const scheduleRefresh = (currentToken: string) => {
      try {
        const payload = JSON.parse(atob(currentToken.split('.')[1]));
        const expiresIn = payload.exp * 1000 - Date.now();
        // Refresh 5 minutes before expiry
        const refreshIn = Math.max(expiresIn - 5 * 60 * 1000, 0);

        timer = setTimeout(async () => {
          const refreshToken = localStorage.getItem(REFRESH_KEY) || sessionStorage.getItem(REFRESH_KEY);
          if (!refreshToken) return;

          try {
            const res = await fetch('/api/auth/refresh', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ refreshToken }),
            });
            if (res.ok) {
              const data = await res.json();
              const remember = !!localStorage.getItem(TOKEN_KEY);
              const storage = remember ? localStorage : sessionStorage;
              storage.setItem(TOKEN_KEY, data.token);
              setToken(data.token);
              scheduleRefresh(data.token);
            } else {
              logout();
            }
          } catch {
            logout();
          }
        }, refreshIn);
      } catch {
        logout();
      }
    };

    scheduleRefresh(token);
    return () => clearTimeout(timer);
  }, [token]);

  const login = useCallback(async (username: string, password: string, remember = false) => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      const storage = remember ? localStorage : sessionStorage;
      storage.setItem(REFRESH_KEY, data.refreshToken);
      persist(data.token, data.user, remember);
    } finally {
      setIsLoading(false);
    }
  }, [persist]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Password change failed');
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
