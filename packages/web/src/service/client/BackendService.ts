"use server";

import { Logger } from "@/utils/Logger";
import { getCookieToken } from "./CookieService";

export async function fetchHelper(url: string, options: RequestInit = {}) {
  const token = getCookieToken();

  const headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errorText = await res.text();
      Logger.error({
        message: "Error en la petición",
        data: {
          status: res.status,
          url: url,
          errorText,
        },
      });
      throw new Error(`Error en la petición: ${res.status}`);
    }

    return await res.json();
  } catch (e) {
    Logger.error({
      message: "Error general en fetchHelper",
      data: { e },
    });

    throw e;
  }
}
