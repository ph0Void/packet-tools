import { envConfig } from "@/config/EnvConfig";
import { api, type ApiResponse } from "@/service/client/ApiClient";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";
const COOKIE_NAME = envConfig.NEXT_PUBLIC_COOKIE_NAME ?? "packet-tools-cookie";

export interface SessionUser {
  id: string;
  username: string;
  role: "USER" | "STAFF" | "ADMIN";
}

export type LoginResult = ApiResponse<SessionUser & { token: string }>;

function extractTokenFromSetCookie(setCookies: string[]): string | null {
  for (const raw of setCookies) {
    const pair = raw.split(";")[0] ?? "";
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== COOKIE_NAME) continue;
    return decodeURIComponent(pair.slice(separator + 1).trim());
  }
  return null;
}

export async function loginAuthService(
  username: string,
  password: string,
): Promise<LoginResult> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
      cache: "no-store",
    });

    const payload = (await res.json()) as ApiResponse<SessionUser>;
    const setCookieHeader = res.headers.get("set-cookie");
    const setCookies =
      typeof res.headers.getSetCookie === "function"
        ? res.headers.getSetCookie()
        : setCookieHeader
          ? [setCookieHeader]
          : [];

    const token = extractTokenFromSetCookie(setCookies);

    if (!res.ok || !payload.success || !payload.data || !token) {
      return {
        success: false,
        message: payload.message || "Credenciales inválidas.",
        data: null,
      };
    }

    return { success: true, message: payload.message, data: { ...payload.data, token } };
  } catch (error) {
    console.error("Error en loginAuthService:", error);
    return {
      success: false,
      message: "No se pudo conectar con el servidor.",
      data: null,
    };
  }
}

export async function registerAuthService(
  username: string,
  password: string,
): Promise<ApiResponse<SessionUser>> {
  return api<SessionUser>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function logoutAuthService(): Promise<ApiResponse<null>> {
  return api<null>("/api/auth/logout", { method: "POST" });
}

export async function meAuthService(): Promise<ApiResponse<SessionUser>> {
  return api<SessionUser>("/api/auth/me");
}
