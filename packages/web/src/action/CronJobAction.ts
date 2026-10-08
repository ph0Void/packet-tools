"use server";

import { revalidatePath } from "next/cache";
import {
  deleteJob,
  getJobs,
  runJob,
  saveJob,
  setJobActive,
} from "@/service/CronJobService";
import type {
  CronJobInput,
  CronJobRunResult,
} from "@/service/CronJobService";
import type { FormState } from "@/types/actions";

export type FormCronJobState<T = unknown> = FormState<T>;

const RUTA_AUTOMATIZACIONES = "/dashboard/jobs";

function parseConfig(raw: string | null): Record<string, unknown> | undefined {
  if (!raw || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

export async function createCronJobAction(
  prevState: FormCronJobState,
  formData: FormData,
): Promise<FormCronJobState> {
  try {
    const name = (formData.get("name") as string)?.trim();
    const description = formData.get("description") as string;
    const cronExpression = formData.get("cronExpression") as string;
    const actionTypeRaw = formData.get("actionType") as string;
    const actionType = actionTypeRaw === "INTELLIGENT" ? "INTELLIGENT" : "STANDARD";
    const prompt = formData.get("prompt") as string;
    const config = parseConfig(formData.get("payload") as string | null);
    const isActive = formData.get("isActive") !== "false";
    const topologyId = formData.get("topologyId") as string;
    const deviceProviderId = formData.get("deviceProviderId") as string;

    if (!name) {
      return {
        success: false,
        message: "Faltan campos obligatorios (Nombre y Tipo de acción).",
      };
    }

    const input: CronJobInput = {
      name,
      description: description?.trim() ? description.trim() : undefined,
      cronExpression: cronExpression?.trim() ? cronExpression.trim() : undefined,
      actionType,
      prompt: prompt?.trim() ? prompt.trim() : undefined,
      ...(config !== undefined ? { config } : {}),
      isActive,
      deviceProviderId: deviceProviderId?.trim() ? deviceProviderId.trim() : undefined,
      topologyId: topologyId?.trim() ? topologyId.trim() : undefined,
    };

    const result = await saveJob(input);

    if (!result.success) {
      return { success: false, message: result.message };
    }

    revalidatePath(RUTA_AUTOMATIZACIONES);
    return {
      success: true,
      message: result.message || "Tarea programada creada correctamente.",
      data: result.data,
    };
  } catch (error) {
    console.error("Error en createCronJobAction:", error);
    return {
      success: false,
      message: "Error al crear la tarea programada.",
    };
  }
}

export async function getAllCronJobsAction(): Promise<FormCronJobState> {
  const result = await getJobs();

  if (!result.success) {
    return {
      success: false,
      message: result.message || "Error al consultar tareas.",
      data: [],
    };
  }

  return { success: true, message: result.message, data: result.data ?? [] };
}

export async function toggleCronJobAction(
  id: string,
  isActive: boolean,
): Promise<FormCronJobState> {
  const result = await setJobActive(id, isActive);

  if (!result.success) {
    return { success: false, message: result.message };
  }

  revalidatePath(RUTA_AUTOMATIZACIONES);
  return { success: true, message: result.message || "Estado actualizado." };
}

export async function deleteCronJobAction(
  id: string,
): Promise<FormCronJobState> {
  const result = await deleteJob(id);

  if (!result.success) {
    return { success: false, message: result.message };
  }

  revalidatePath(RUTA_AUTOMATIZACIONES);
  return { success: true, message: result.message || "Tarea eliminada." };
}

export async function runJobAction(
  id: string,
): Promise<FormCronJobState<CronJobRunResult>> {
  const result = await runJob(id);

  if (!result.success) {
    return { success: false, message: result.message };
  }

  revalidatePath(RUTA_AUTOMATIZACIONES);
  return {
    success: true,
    message: result.message || "Ejecución de la tarea programada.",
    data: result.data ?? undefined,
  };
}
