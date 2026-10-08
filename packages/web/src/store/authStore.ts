import { Logger } from "@/utils/Logger";
import { create } from "zustand";

interface User {
  id: string;
  username: string;
  role: "ADMIN" | "STAFF" | "USER";
}

interface AuthStore {
  user: User | null;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,

  setUser: (user) => set({ user }),

  logout: async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      Logger.error({
        message: `[AUTH_STORE] Error cerrando sesión ${get().user?.username} `,
      });
    }
    set({ user: null });
  },

  checkSession: async () => {
    try {
      const response = await fetch("/api/auth/me");
      const data = await response.json();
      if (data.success && data.user) {
        set({ user: data.user });
      } else {
        set({ user: null });
      }
    } catch {
      Logger.error({
        message: `[AUTH_STORE] Error verificando sesión ${get().user?.username} `,
      });
      set({ user: null });
    }
  },
}));
