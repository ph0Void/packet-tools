import type { DeviceProvider } from "@/service/DeviceProviderService";
import type { ApiResponse } from "@/service/client/ApiClient";

export interface TerminalActiveSession {
  sessionId: string;
  deviceName: string | null;
  protocol: string | null;
  providerId: string | null;
  busy: boolean;
  prompt: string | null;
}

interface ApiEnvelope<T> {
  success?: boolean;
  message?: string;
  data?: T;
}

export async function getActiveSessions(): Promise<TerminalActiveSession[]> {
  try {
    const res = await fetch("/api/terminal/sessions", {
      credentials: "include",
      cache: "no-store",
    });
    const json = (await res.json()) as ApiEnvelope<TerminalActiveSession[]>;
    return json.success && Array.isArray(json.data) ? json.data : [];
  } catch {
    return [];
  }
}

export async function getConnectionDevices(): Promise<DeviceProvider[]> {
  try {
    const res = await fetch("/api/devices", {
      credentials: "include",
      cache: "no-store",
    });
    const json = (await res.json()) as ApiEnvelope<DeviceProvider[]>;
    return json.success && Array.isArray(json.data) ? json.data : [];
  } catch {
    return [];
  }
}

export interface TerminalOpenConfirmBody {
  accepted: boolean;
  sessionId?: string;
  error?: string;
}

export interface TerminalOpenConfirmResult {
  requestId: string;
  accepted: boolean;
}

export async function confirmTerminalOpen(
  requestId: string,
  body: TerminalOpenConfirmBody,
): Promise<ApiResponse<TerminalOpenConfirmResult>> {
  try {
    const res = await fetch(
      `/api/chats/terminal-open/${encodeURIComponent(requestId)}`,
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res
      .json()
      .catch(() => null)) as ApiResponse<TerminalOpenConfirmResult> | null;
    if (!res.ok || !json?.success) {
      return {
        success: false,
        message:
          json?.message || `Error ${res.status} al confirmar la apertura`,
        data: null,
      };
    }
    return json;
  } catch {
    return {
      success: false,
      message: "No se pudo contactar con el servidor",
      data: null,
    };
  }
}
