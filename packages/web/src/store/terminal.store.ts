import { create } from "zustand";
import { persist } from "zustand/middleware";

const BUFFER_MAX_CHARS = 8000;
const MAX_PENDING_INJECTIONS = 10;

export const LINEAS_TAIL_TERMINAL = [0, 10, 25, 50, 100] as const;

export type LineasTailTerminal = (typeof LINEAS_TAIL_TERMINAL)[number];

export type TerminalStatus = "DISCONNECTED" | "CONNECTING" | "CONNECTED";

export interface TerminalInjection {
  id: string;
  deviceName: string | null;
  commands: string[];

  routed: boolean;
  createdAt: number;
}

export interface PendingOpenRequest {
  requestId: string;
  payload: Record<string, unknown>;
}

interface TerminalStore {
  buffer: string;
  status: TerminalStatus;
  deviceProviderId: string | null;

  attachOutput: boolean;

  attachOutputLines: LineasTailTerminal;

  localEcho: boolean;

  terminalBusy: boolean;

  pendingInjections: TerminalInjection[];

  lastConnectPayload: Record<string, unknown> | null;

  pendingOpenRequest: PendingOpenRequest | null;

  reconnectTick: number;

  activeSessionId: string | null;

  activeSessionProtocol: string | null;

  activeSessionDevice: string | null;

  activeSessionProviderId: string | null;

  appendBuffer: (chunk: string) => void;
  clearBuffer: () => void;
  setStatus: (status: TerminalStatus) => void;
  setDeviceProviderId: (id: string | null) => void;
  setAttachOutput: (attach: boolean) => void;
  setAttachOutputLines: (lineas: LineasTailTerminal) => void;
  setLocalEcho: (enabled: boolean) => void;
  setTerminalBusy: (busy: boolean) => void;
  enqueueInjection: (injection: {
    deviceName: string | null;
    commands: string[];
    routed: boolean;
  }) => void;
  shiftInjection: () => void;
  clearInjections: () => void;
  setLastConnectPayload: (payload: Record<string, unknown> | null) => void;
  setPendingOpenRequest: (request: PendingOpenRequest) => void;
  clearPendingOpenRequest: () => void;
  requestReconnect: () => void;

  setActiveSessionInfo: (info: {
    sessionId?: string | null;
    protocol?: string | null;
    deviceName?: string | null;
    providerId?: string | null;
  }) => void;

  clearActiveSessionInfo: () => void;
}

let injectionSeq = 0;

export const useTerminalStore = create<TerminalStore>()(
  persist(
    (set) => ({
      buffer: "",
      status: "DISCONNECTED",
      deviceProviderId: null,

      attachOutput: false,
      attachOutputLines: 0,
      localEcho: true,
      terminalBusy: false,
      pendingInjections: [],
      lastConnectPayload: null,
      pendingOpenRequest: null,
      reconnectTick: 0,
      activeSessionId: null,
      activeSessionProtocol: null,
      activeSessionDevice: null,
      activeSessionProviderId: null,

      appendBuffer: (chunk) =>
        set((state) => ({
          buffer: (state.buffer + chunk).slice(-BUFFER_MAX_CHARS),
        })),

      clearBuffer: () => set({ buffer: "" }),

      setStatus: (status) => set({ status }),

      setDeviceProviderId: (deviceProviderId) => set({ deviceProviderId }),

      setAttachOutput: (attachOutput) => set({ attachOutput }),

      setAttachOutputLines: (attachOutputLines) => set({ attachOutputLines }),

      setLocalEcho: (localEcho) => set({ localEcho }),

      setTerminalBusy: (terminalBusy) => set({ terminalBusy }),

      enqueueInjection: ({ deviceName, commands, routed }) =>
        set((state) => ({
          pendingInjections: [
            ...state.pendingInjections.slice(-(MAX_PENDING_INJECTIONS - 1)),
            {
              id: `inj-${Date.now()}-${injectionSeq++}`,
              deviceName,
              commands,
              routed,
              createdAt: Date.now(),
            },
          ],
        })),

      shiftInjection: () =>
        set((state) => ({ pendingInjections: state.pendingInjections.slice(1) })),

      clearInjections: () => set({ pendingInjections: [] }),

      setLastConnectPayload: (lastConnectPayload) => set({ lastConnectPayload }),

      setPendingOpenRequest: (pendingOpenRequest) => set({ pendingOpenRequest }),

      clearPendingOpenRequest: () => set({ pendingOpenRequest: null }),

      requestReconnect: () =>
        set((state) => ({ reconnectTick: state.reconnectTick + 1 })),

      setActiveSessionInfo: ({ sessionId, protocol, deviceName, providerId }) =>
        set((state) => ({
          activeSessionId:
            sessionId !== undefined ? sessionId : state.activeSessionId,
          activeSessionProtocol:
            protocol !== undefined ? protocol : state.activeSessionProtocol,
          activeSessionDevice:
            deviceName !== undefined ? deviceName : state.activeSessionDevice,
          activeSessionProviderId:
            providerId !== undefined ? providerId : state.activeSessionProviderId,
        })),

      clearActiveSessionInfo: () =>
        set({
          activeSessionId: null,
          activeSessionProtocol: null,
          activeSessionDevice: null,
          activeSessionProviderId: null,
        }),
    }),
    {

      name: "terminal-prefs-storage",
      partialize: (state) => ({
        attachOutput: state.attachOutput,
        attachOutputLines: state.attachOutputLines,
      }),
    },
  ),
);
