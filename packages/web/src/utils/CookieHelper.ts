"use server";

import { cookies } from "next/headers";
import { envConfig } from "@/config/EnvConfig";

const COOKIE_NAME = envConfig.NEXT_PUBLIC_COOKIE_NAME;

export async function saveCookieToken(token: string) {
  (await cookies()).set(COOKIE_NAME!, token, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 30, // 30 días (igual que el backend)
    path: "/",
    sameSite: "lax",
  });
}

export async function getCookieToken() {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME!)?.value;
}

export async function deleteCookieToken() {
  (await cookies()).delete(COOKIE_NAME!);
}
