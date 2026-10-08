import { getAuthHeader } from "@/service/client/CookieService";

const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data: T | null;
}

export async function api<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  try {
    const headers = new Headers(init?.headers);
    Object.entries(await getAuthHeader()).forEach(([key, value]) =>
      headers.set(key, value),
    );

    if (
      init?.body &&
      !(init.body instanceof FormData) &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });

    return (await res.json()) as ApiResponse<T>;
  } catch (error) {
    console.error(`Error en la petición a ${path}:`, error);
    return {
      success: false,
      message: "No se pudo conectar con el servidor.",
      data: null,
    };
  }
}
