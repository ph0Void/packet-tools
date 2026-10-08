import type {
  ChatMessageRecord,
  ChatSession,
} from "@/hooks/useCiscoChat";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface SeleccionChat {
  modelProviderId?: string | null;
  connectionId?: string | null;
}

interface ChatStore {
  chats: ChatSession[];
  activeChatId: string | null;
  messages: ChatMessageRecord[];
  streamingText: string;
  isStreaming: boolean;
  agentProvider: string;
  modelProviderId: string | null;

  autonomousMode: boolean;

  chatModels: Record<string, string | null>;

  selectedConnectionId: string | null;

  chatConnections: Record<string, string | null>;

  setChats: (chats: ChatSession[]) => void;
  upsertChat: (chat: ChatSession) => void;
  removeChat: (id: string) => void;
  setActiveChatId: (id: string | null) => void;
  setMessages: (messages: ChatMessageRecord[]) => void;
  addMessage: (message: ChatMessageRecord) => void;
  setStreaming: (isStreaming: boolean) => void;
  appendStreamingText: (text: string) => void;
  clearStreamingText: () => void;
  setAgentProvider: (provider: string) => void;
  setModelProviderId: (id: string | null) => void;
  setAutonomousMode: (value: boolean) => void;

  setChatModel: (chatId: string, modelId: string | null) => void;

  aplicarSeleccionChat: (chatId: string, seleccion: SeleccionChat) => void;

  hidratarSeleccionChat: (chatId: string, seleccion: SeleccionChat) => void;

  restaurarSeleccionChat: (chatId: string) => void;

  pruneChatModels: (validIds: string[]) => void;

  setSelectedConnectionId: (id: string | null) => void;

  setChatConnection: (chatId: string, deviceId: string | null) => void;

  pruneChatConnections: (validIds: string[]) => void;
}

const memoryStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      chats: [],
      activeChatId: null,
      messages: [],
      streamingText: "",
      isStreaming: false,
      agentProvider: "general",
      modelProviderId: null,
      autonomousMode: false,
      chatModels: {},
      selectedConnectionId: null,
      chatConnections: {},

      setChats: (chats) => set({ chats }),

      upsertChat: (chat) =>
        set((state) => {
          const exists = state.chats.some((c) => c.id === chat.id);
          return {
            chats: exists
              ? state.chats.map((c) => (c.id === chat.id ? { ...c, ...chat } : c))
              : [chat, ...state.chats],
          };
        }),

      removeChat: (id) =>
        set((state) => ({
          chats: state.chats.filter((c) => c.id !== id),
          activeChatId: state.activeChatId === id ? null : state.activeChatId,
          messages: state.activeChatId === id ? [] : state.messages,
        })),

      setActiveChatId: (activeChatId) =>
        set((state) => {
          const chat = state.chats.find((c) => c.id === activeChatId);
          return { activeChatId, messages: chat ? [...chat.messages] : [] };
        }),

      setMessages: (messages) => set({ messages }),

      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),

      setStreaming: (isStreaming) => set({ isStreaming }),

      appendStreamingText: (text) =>
        set((state) => ({ streamingText: state.streamingText + text })),

      clearStreamingText: () => set({ streamingText: "" }),

      setAgentProvider: (agentProvider) => set({ agentProvider }),

      setModelProviderId: (modelProviderId) => set({ modelProviderId }),

      setAutonomousMode: (autonomousMode) => set({ autonomousMode }),

      setChatModel: (chatId, modelId) =>
        set((state) => ({

          chatModels: { ...state.chatModels, [chatId]: modelId },
        })),

      aplicarSeleccionChat: (chatId, seleccion) =>
        set((state) => {
          const next: Partial<ChatStore> = {};
          if (seleccion.modelProviderId !== undefined) {
            next.chatModels = {
              ...state.chatModels,
              [chatId]: seleccion.modelProviderId,
            };
          }
          if (seleccion.connectionId !== undefined) {
            next.chatConnections = {
              ...state.chatConnections,
              [chatId]: seleccion.connectionId,
            };
          }
          return next;
        }),

      hidratarSeleccionChat: (chatId, seleccion) =>
        set((state) => {

          const next: Partial<ChatStore> = {};
          if (
            typeof seleccion.modelProviderId === "string" &&
            state.chatModels[chatId] === undefined
          ) {
            next.chatModels = {
              ...state.chatModels,
              [chatId]: seleccion.modelProviderId,
            };
          }
          if (
            typeof seleccion.connectionId === "string" &&
            state.chatConnections[chatId] === undefined
          ) {
            next.chatConnections = {
              ...state.chatConnections,
              [chatId]: seleccion.connectionId,
            };
          }
          return next;
        }),

      restaurarSeleccionChat: (chatId) =>
        set((state) => {

          const next: Partial<ChatStore> = {};
          const modelo = state.chatModels[chatId];
          if (modelo !== undefined) next.modelProviderId = modelo;
          const conexion = state.chatConnections[chatId];
          if (conexion !== undefined) next.selectedConnectionId = conexion;
          return next;
        }),

      pruneChatModels: (validIds) =>
        set((state) => {
          const valid = new Set(validIds);

          const entries = Object.entries(state.chatModels).filter(
            ([, id]) => id === null || valid.has(id),
          );

          if (entries.length === Object.keys(state.chatModels).length) {
            return state;
          }
          return { chatModels: Object.fromEntries(entries) };
        }),

      setSelectedConnectionId: (id) => set({ selectedConnectionId: id }),

      setChatConnection: (chatId, deviceId) =>
        set((state) => ({

          chatConnections: { ...state.chatConnections, [chatId]: deviceId },
        })),

      pruneChatConnections: (validIds) =>
        set((state) => {
          const valid = new Set(validIds);

          const entries = Object.entries(state.chatConnections).filter(
            ([, deviceId]) => deviceId === null || valid.has(deviceId),
          );

          if (entries.length === Object.keys(state.chatConnections).length) {
            return state;
          }
          return { chatConnections: Object.fromEntries(entries) };
        }),
    }),
    {
      name: "packet-tools-chat",
      partialize: (state) => ({
        activeChatId: state.activeChatId,
        agentProvider: state.agentProvider,
        modelProviderId: state.modelProviderId,
        autonomousMode: state.autonomousMode,
        chatModels: state.chatModels,
        selectedConnectionId: state.selectedConnectionId,
        chatConnections: state.chatConnections,
      }),
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? memoryStorage : window.localStorage,
      ),
    },
  ),
);
