"use server";

import { revalidatePath } from "next/cache";
import {
  deleteDocument,
  getDocuments,
  uploadDocument,
} from "@/service/KnowledgeBaseService";
import type { FormState } from "@/types/actions";

export type FormKnowledgeState = FormState;

const ALLOWED_EXTENSIONS = [".pdf", ".txt", ".md"];
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function validateFile(file: File): string | null {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return "Formato no permitido. Solo se aceptan archivos .pdf, .txt y .md.";
  }

  if (file.size > MAX_FILE_SIZE) {
    return "El archivo supera el límite de 25MB.";
  }

  return null;
}

export async function getDocumentsAction(): Promise<FormKnowledgeState> {
  const result = await getDocuments();

  if (!result.success) {
    return {
      success: false,
      message: result.message || "Error al obtener documentos.",
      data: [],
    };
  }

  return { success: true, message: result.message, data: result.data ?? [] };
}

export async function uploadDocumentAction(
  prevState: FormKnowledgeState,
  formData: FormData,
): Promise<FormKnowledgeState> {
  try {
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File) || fileEntry.size === 0) {
      return { success: false, message: "Debes seleccionar un archivo." };
    }

    const validationError = validateFile(fileEntry);
    if (validationError) {
      return { success: false, message: validationError };
    }

    const result = await uploadDocument(formData);

    if (!result.success) {
      return { success: false, message: result.message };
    }

    revalidatePath("/dashboard/knowledge");
    return {
      success: true,
      message: result.message || "Documento subido correctamente.",
      data: result.data,
    };
  } catch (error) {
    console.error("Error en uploadDocumentAction:", error);
    return { success: false, message: "Error al subir el documento." };
  }
}

export async function deleteDocumentAction(
  id: string,
): Promise<FormKnowledgeState> {
  const result = await deleteDocument(id);

  if (!result.success) {
    return { success: false, message: result.message };
  }

  revalidatePath("/dashboard/knowledge");
  return { success: true, message: result.message || "Documento eliminado." };
}
