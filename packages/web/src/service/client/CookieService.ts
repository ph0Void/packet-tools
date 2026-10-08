import { cookies } from "next/headers";
import { envConfig } from "@/config/EnvConfig";

export async function getCookieToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(envConfig.NEXT_PUBLIC_COOKIE_NAME ?? "")?.value;
  return token ?? null;
}

export async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getCookieToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
