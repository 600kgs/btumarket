import { createContext, useContext, useState, type ReactNode } from "react";

interface AuthState {
  username: string | null;
  token: string | null;
  isLoggedIn: boolean;
  login: (username: string, token: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem("username"));
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));

  const login = (newUsername: string, newToken: string) => {
    localStorage.setItem("username", newUsername);
    localStorage.setItem("token", newToken);
    setUsername(newUsername);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem("username");
    localStorage.removeItem("token");
    setUsername(null);
    setToken(null);
  };

  return (
    <AuthContext.Provider value={{ username, token, isLoggedIn: !!token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
