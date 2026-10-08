import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface KnowledgeDocument {
  id: string;
  title: string;
  description: string | null;
  fileUrl: string;
  createdAt: string;
}

export function getDocuments(): Promise<ApiResponse<KnowledgeDocument[]>> {
  return api<KnowledgeDocument[]>("/api/data");
}

export function uploadDocument(
  formData: FormData,
): Promise<ApiResponse<KnowledgeDocument>> {
  return api<KnowledgeDocument>("/api/data", {
    method: "POST",
    body: formData,
  });
}

export function deleteDocument(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/data/${id}`, { method: "DELETE" });
}
