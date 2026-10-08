"use server";

import { meAuthService } from "@/service/AuthService";
import { getCookieToken } from "@/service/client/CookieService";

export interface SessionUser {
  id: string;
  username: string;
  role: "USER" | "STAFF" | "ADMIN";
}

export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const token = await getCookieToken();
    if (!token) return null;

    const result = await meAuthService();

    if (!result.success || !result.data) return null;

    return {
      id: result.data.id,
      username: result.data.username,
      role: result.data.role,
    };
  } catch (error) {
    const digest = (error as { digest?: string } | null)?.digest;
    if (
      typeof digest === "string" &&
      (digest === "DYNAMIC_SERVER_USAGE" || digest.startsWith("NEXT_"))
    ) {
      throw error;
    }
    console.error("Error en getSessionUser:", error);
    return null;
  }
}
