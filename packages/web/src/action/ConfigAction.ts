"use server";

import { revalidatePath } from "next/cache";
import {
  deleteModelProvider,
  getAvailableModels,
  getConfig,
  getModelProviders,
  saveModelProvider,
  testModelProvider,
  updateAgentLogsEnabled,
  updateSystemPrompt,
  type TestModelProviderInput,
} from "@/service/ConfigService";
import type { FormState } from "@/types/actions";

export type FormConfigState = FormState;

export async function getSystemConfigAction(): Promise<FormConfigState> {
  const result = await getConfig();

  if (!result.success || !result.data) {
    return {
      success: false,
      message: result.message || "No autorizado.",
      data: null,
    };
  }

  return {
    success: true,
    message: "Configuración obtenida correctamente",
    data: result.data,
  };
}

export async function getAvailableModelsAction(): Promise<FormConfigState> {
  const result = await getAvailableModels();

  if (!result.success) {
    return {
      success: false,
      message: result.message || "Error al obtener modelos disponibles.",
      data: [],
    };
  }

  return { success: true, message: "Modelos obtenidos", data: result.data ?? [] };
}

export async function getAllModelProvidersAction(): Promise<FormConfigState> {
  const result = await getModelProviders();

  if (!result.success) {
    return {
      success: false,
      message: result.message || "Error al obtener proveedores.",
      data: [],
    };
  }

  return { success: true, message: "Proveedores obtenidos", data: result.data ?? [] };
}

export async function saveModelProviderAction(
  prevState: FormConfigState,
  formData: FormData,
): Promise<FormConfigState> {
  try {
    const id = formData.get("id") as string;
    const name = (formData.get("name") as string)?.trim();
    const provider = formData.get("provider") as string;
    const modelName = (formData.get("modelName") as string)?.trim();
    const typeModel = formData.get("typeModel") as string;
    const baseUrl = formData.get("baseUrl") as string;
    const apiKey = formData.get("apiKey") as string;
    const temperature = formData.get("temperature")
      ? Number(formData.get("temperature"))
      : 0.7;
    const isActive = formData.get("isActive") !== "false";
    const userPermission =
      (formData.get("userPermission") as string) || "USER,STAFF,ADMIN";

    if (!name || !modelName) {
      return {
        success: false,
        message: "Nombre y modelo de IA son obligatorios.",
      };
    }

    const result = await saveModelProvider({
      ...(id ? { id } : {}),
      name,
      provider: provider || "CUSTOM",
      modelName,
      ...(typeModel ? { typeModel } : {}),
      baseUrl: baseUrl || undefined,
      apiKey: apiKey || undefined,
      temperature:
        Number.isFinite(temperature) && temperature >= 0
          ? temperature
          : 0.7,
      isActive,
      userPermission,
    });

    if (!result.success) {
      return { success: false, message: result.message };
    }

    revalidatePath("/dashboard/config");
    return {
      success: true,
      message: "Modelo de IA guardado correctamente.",
      data: result.data,
    };
  } catch (error) {
    console.error("Error en saveModelProviderAction:", error);
    return { success: false, message: "Error guardando el modelo." };
  }
}

export async function testModelProviderAction(
  prevState: FormConfigState,
  payload: TestModelProviderInput,
): Promise<FormConfigState> {
  void prevState;
  try {
    const result = await testModelProvider(payload);

    if (!result.success) {
      return { success: false, message: result.message };
    }

    return {
      success: true,
      message: result.message || "Conexión correcta.",
      data: result.data,
    };
  } catch (error) {
    console.error("Error en testModelProviderAction:", error);
    return { success: false, message: "Error al probar la conexión." };
  }
}

export async function deleteModelProviderAction(
  idModel: string,
): Promise<FormConfigState> {
  try {
    const result = await deleteModelProvider(idModel);

    if (!result.success) {
      return { success: false, message: result.message };
    }

    revalidatePath("/dashboard/config");
    return { success: true, message: "Modelo eliminado correctamente." };
  } catch (error) {
    console.error("Error en deleteModelProviderAction:", error);
    return { success: false, message: "Error al eliminar el modelo." };
  }
}

export async function updateSystemPromptAction(
  prevState: FormConfigState,
  formData: FormData,
): Promise<FormConfigState> {
  try {
    const systemPrompt = String(formData.get("systemPrompt") ?? "").trim();

    if (!systemPrompt) {
      return {
        ...prevState,
        success: false,
        message: "El prompt del sistema no puede estar vacío.",
      };
    }

    const result = await updateSystemPrompt(systemPrompt);

    if (!result.success) {
      return { ...prevState, success: false, message: result.message };
    }

    revalidatePath("/dashboard/config");
    return {
      success: true,
      message: "Prompt del sistema actualizado correctamente.",
    };
  } catch (error) {
    console.error("Error en updateSystemPromptAction:", error);
    return {
      ...prevState,
      success: false,
      message: "Error al actualizar la configuración.",
    };
  }
}

export async function updateAgentLogsEnabledAction(
  enabled: boolean,
): Promise<FormConfigState> {
  try {
    const result = await updateAgentLogsEnabled(enabled);

    if (!result.success) {
      return {
        success: false,
        message:
          result.message || "No se pudo cambiar el registro de la traza del agente.",
      };
    }

    revalidatePath("/dashboard/configuration");
    return {
      success: true,
      message:
        result.message ||
        (enabled
          ? "Traza del agente activada."
          : "Traza del agente desactivada."),
      data: result.data,
    };
  } catch (error) {
    console.error("Error en updateAgentLogsEnabledAction:", error);
    return {
      success: false,
      message: "Error al cambiar el registro de la traza del agente.",
    };
  }
}
