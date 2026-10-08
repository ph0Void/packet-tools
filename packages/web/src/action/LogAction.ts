"use server";

import { revalidatePath } from "next/cache";
import {
  clearLogs,
  deleteLog,
  getLogLevels,
  getLogs,
  type LogEntry,
  type LogsPage,
} from "@/service/LogService";
import type { FormState } from "@/types/actions";

export type FormLogState = FormState<LogsPage> & {
  page?: number;
  limit?: number;
  total?: number;
};

export type FormLogLevelState = FormState<LogEntry[]>;

export type FormLogLevelsState = FormState<string[]>;

export async function getAllLogsAction(
  page: number = 1,
  limit: number = 10,
  level?: string,
): Promise<FormLogState> {
  const result = await getLogs({ page, limit, level });

  if (!result.success || !result.data) {
    return {
      success: false,
      message: result.message || "No autorizado.",
      data: undefined,
    };
  }

  return {
    success: true,
    message: result.message,
    data: result.data,
    page: result.data.page,
    limit: result.data.limit,
    total: result.data.total,
  };
}

export async function getLogsByLevelAction(
  level: string,
): Promise<FormLogLevelState> {
  const result = await getLogs({ level });

  if (!result.success) {
    return { success: false, message: result.message, data: [] };
  }

  return { success: true, message: result.message, data: result.data?.items ?? [] };
}

export async function getLogLevelsAction(): Promise<FormLogLevelsState> {
  const result = await getLogLevels();

  if (!result.success) {
    return {
      success: false,
      message: result.message || "No se pudieron obtener los niveles de log.",
      data: [],
    };
  }

  return {
    success: true,
    message: result.message,
    data: result.data ?? [],
  };
}

export async function deleteLogAction(id: string): Promise<FormLogState> {
  const result = await deleteLog(id);

  if (!result.success) {
    return { success: false, message: result.message };
  }

  revalidatePath("/dashboard/log");
  return { success: true, message: result.message || "Log eliminado." };
}

export async function clearLogsAction(id?: string): Promise<FormLogState> {
  if (id) {
    return await deleteLogAction(id);
  }

  const result = await clearLogs();

  if (!result.success) {
    return { success: false, message: result.message };
  }

  revalidatePath("/dashboard/log");
  return { success: true, message: result.message || "Registros limpiados." };
}
