"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { api } from "./api";

interface AuthUser {
  id: string;
  email: string;
  username: string;
  name: string;
  avatarUrl: string | null;
  roles: string[];
  usernameSet: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isGuest: boolean;
  loading: boolean;
  logout: () => Promise<void>;
  loginAsGuest: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isGuest, setIsGuest] = useState(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("guest") === "1";
  });
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await api<AuthUser>("/auth/me");
      setUser(data);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    api<AuthUser>("/auth/me")
      .then((data) => {
        setUser(data);
        setIsGuest(false);
        sessionStorage.removeItem("guest");
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    if (isGuest) {
      setIsGuest(false);
      sessionStorage.removeItem("guest");
      return;
    }
    try {
      await api("/auth/logout", { method: "POST" });
    } finally {
      setUser(null);
    }
  }, [isGuest]);

  const loginAsGuest = useCallback(() => {
    setIsGuest(true);
    sessionStorage.setItem("guest", "1");
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isGuest, loading, logout, loginAsGuest, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
