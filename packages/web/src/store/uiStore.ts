import { create } from "zustand";
import { persist } from "zustand/middleware";

export const CHAT_PANEL_MIN_WIDTH = 320;
export const CHAT_PANEL_MAX_WIDTH = 760;
export const CHAT_PANEL_DEFAULT_WIDTH = 420;

interface stateUIStore {
  theme: "light" | "dark";
  isMenuOpen: boolean;

  isChatPanelOpen: boolean;

  chatPanelWidth: number;

  openMenu: () => void;
  closeMenu: () => void;
  toggleMenu: () => void;
  changeTheme: () => void;
  openChatPanel: () => void;
  closeChatPanel: () => void;
  toggleChatPanel: () => void;
  setChatPanelWidth: (width: number) => void;
}

export const useUiStore = create<stateUIStore>()(
  persist(
    (set) => ({

      theme: "dark",
      isMenuOpen: false,
      isChatPanelOpen: false,
      chatPanelWidth: CHAT_PANEL_DEFAULT_WIDTH,

      openMenu: () => set({ isMenuOpen: true }),
      closeMenu: () => set({ isMenuOpen: false }),
      toggleMenu: () => set((s) => ({ isMenuOpen: !s.isMenuOpen })),
      changeTheme: () =>
        set((state) => ({
          theme: state.theme === "light" ? "dark" : "light",
        })),

      openChatPanel: () => set({ isChatPanelOpen: true }),
      closeChatPanel: () => set({ isChatPanelOpen: false }),
      toggleChatPanel: () =>
        set((state) => ({ isChatPanelOpen: !state.isChatPanelOpen })),

      setChatPanelWidth: (width) =>
        set({
          chatPanelWidth: Math.min(
            CHAT_PANEL_MAX_WIDTH,
            Math.max(CHAT_PANEL_MIN_WIDTH, Math.round(width)),
          ),
        }),
    }),
    {
      name: "ui-storage",

      partialize: (state) => ({
        theme: state.theme,
        chatPanelWidth: state.chatPanelWidth,
      }),
    },
  ),
);
