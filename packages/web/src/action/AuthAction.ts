"use server";

import {
  loginAuthService,
  logoutAuthService,
  registerAuthService,
} from "@/service/AuthService";
import { deleteCookieToken, saveCookieToken } from "@/utils/CookieHelper";
import type { FormState as BaseFormState } from "@/types/actions";

export type FormState = BaseFormState;

export async function loginAction(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username) {
    return { success: false, message: "El nombre de usuario es requerido." };
  }

  if (!password) {
    return { success: false, message: "La contraseña es requerida." };
  }

  try {
    const result = await loginAuthService(username, password);

    if (!result.success || !result.data) {
      return {
        success: false,
        message: result.message || "Credenciales inválidas.",
      };
    }

    await saveCookieToken(result.data.token);

    return {
      success: true,
      message: "¡Conexión exitosa! Redirigiendo...",
      data: result.data,
    };
  } catch (error) {
    console.error("Error en loginAction:", error);
    return {
      success: false,
      message: "Ocurrió un error inesperado en el servidor.",
    };
  }
}

export async function registerAction(
  prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username) {
    return { success: false, message: "El nombre de usuario es requerido." };
  }

  if (!password || password.length < 6) {
    return {
      success: false,
      message: "La contraseña es requerida (mínimo 6 caracteres).",
    };
  }

  try {
    const result = await registerAuthService(username, password);

    if (!result.success || !result.data) {
      return {
        success: false,
        message: result.message || "No se pudo registrar el usuario.",
      };
    }

    return {
      success: true,
      message: "Usuario registrado. Inicia sesión.",
      data: result.data,
    };
  } catch (error) {
    console.error("Error en registerAction:", error);
    return {
      success: false,
      message: "Ocurrió un error inesperado en el servidor.",
    };
  }
}

export async function logoutAction(): Promise<FormState> {
  try {
    await logoutAuthService();
  } catch (error) {
    console.error("Error al cerrar sesión en el backend:", error);
  }

  await deleteCookieToken();

  return {
    success: true,
    message: "¡Sesión cerrada! Redirigiendo...",
  };
}
