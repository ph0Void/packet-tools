"use server";

import { revalidatePath } from "next/cache";
import {
  createAlert,
  deleteAlert,
  updateAlert,
} from "@/service/AlertService";
import type { FormState } from "@/types/actions";

export type FormAlertState = FormState;

export async function createAlertAction(
  prevState: FormAlertState,
  formData: FormData,
): Promise<FormAlertState> {
  try {
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const severity = String(formData.get("severity") ?? "").trim();
    const topologyId = String(formData.get("topology") ?? "").trim();

    if (!title || !description || !topologyId) {
      return {
        success: false,
        message: "Todos los campos obligatorios deben ser completados.",
      };
    }

    const result = await createAlert({
      title,
      description,
      severity: severity || "INFO",
      topologyId,
    });

    if (!result.success) {
      return { success: false, message: result.message };
    }

    revalidatePath("/dashboard/alert");
    return { success: true, message: "Incidencia reportada con éxito." };
  } catch (error) {
    console.error("Error en createAlertAction:", error);
    return { success: false, message: "Error interno al procesar el reporte." };
  }
}

export async function updateAlertAction(
  prevState: FormAlertState,
  formData: FormData,
): Promise<FormAlertState> {
  try {
    const id = formData.get("id");
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const severity = String(formData.get("severity") ?? "").trim();
    const topologyId = String(formData.get("topology") ?? "").trim();

    if (!id) {
      return { success: false, message: "ID de alerta no proporcionado." };
    }

    const result = await updateAlert(String(id), {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(severity ? { severity } : {}),
      ...(topologyId ? { topologyId } : {}),
    });

    if (!result.success) {
      return { success: false, message: result.message };
    }

    revalidatePath("/dashboard/alert");
    return {
      success: true,
      message: "Gravedad de la alerta actualizada correctamente.",
    };
  } catch (error) {
    console.error("Error en updateAlertAction:", error);
    return { success: false, message: "Error interno al actualizar la alerta." };
  }
}

export async function solveAlertAction(id: string): Promise<FormAlertState> {
  const result = await updateAlert(id, { resolved: true });

  if (result.success) revalidatePath("/dashboard/alert");

  return {
    success: result.success,
    message:
      result.message ||
      (result.success
        ? "Alerta marcada como resuelta."
        : "No se pudo resolver la alerta."),
  };
}

export async function toggleAlertResolvedAction(
  id: string,
  resolved: boolean,
): Promise<FormAlertState> {
  const result = await updateAlert(id, { resolved });

  if (result.success) revalidatePath("/dashboard/alert");

  return {
    success: result.success,
    message:
      result.message ||
      (result.success
        ? "Estado de la alerta actualizado."
        : "No se pudo actualizar la alerta."),
  };
}

export async function deleteAlertAction(id: string): Promise<FormAlertState> {
  const result = await deleteAlert(id);

  if (result.success) revalidatePath("/dashboard/alert");

  return {
    success: result.success,
    message:
      result.message ||
      (result.success
        ? "Alerta eliminada."
        : "No se pudo eliminar la alerta."),
  };
}
