import { create } from "zustand";

export interface UserInfo {
  id: number;
  username: string;
  role: "superadmin" | "operator" | "viewer";
  mustChangePassword: boolean;
  hasTotp: boolean;
}

interface AuthState {
  authMode: "off" | "required";
  authenticated: boolean;
  user: UserInfo | null;
  csrfToken: string | null;
  status: "loading" | "ready";
  bootstrap: () => Promise<void>;
  setAuth: (data: {
    authenticated: boolean;
    authMode?: "off" | "required";
    user?: UserInfo | null;
    csrfToken?: string | null;
  }) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  authMode: "off",
  authenticated: false,
  user: null,
  csrfToken: null,
  status: "loading",

  bootstrap: async () => {
    try {
      const res = await fetch("/api/me");
      const data = await res.json();
      set({
        authMode: data.authMode || "off",
        authenticated: Boolean(data.authenticated),
        user: data.user || null,
        csrfToken: data.csrfToken || null,
        status: "ready",
      });
    } catch (err) {
      console.error("Failed to bootstrap auth state:", err);
      set({
        authMode: "off",
        authenticated: false,
        user: null,
        csrfToken: null,
        status: "ready",
      });
    }
  },

  setAuth: (data) => {
    set((state) => ({
      ...state,
      ...data,
      status: "ready",
    }));
  },

  clearAuth: () => {
    set({
      authenticated: false,
      user: null,
      csrfToken: null,
      status: "ready",
    });
  },
}));

export const useAuth = () => {
  const auth = useAuthStore();
  return {
    authMode: auth.authMode,
    authenticated: auth.authenticated,
    user: auth.user,
    csrfToken: auth.csrfToken,
    status: auth.status,
    bootstrap: auth.bootstrap,
    setAuth: auth.setAuth,
    clearAuth: auth.clearAuth,
  };
};
