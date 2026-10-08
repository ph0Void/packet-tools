import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface NetworkAlert {
  id: string;
  title: string;
  description: string;
  severity: string;
  resolved: boolean;
  topologyId: string | null;
  userId: string | null;
  createdAt: string;
}

export interface AlertInput {
  title: string;
  description: string;
  severity: string;
  topologyId?: string | null;
  resolved?: boolean;
}

export function getAlerts(): Promise<ApiResponse<NetworkAlert[]>> {
  return api<NetworkAlert[]>("/api/alerts");
}

export function createAlert(input: AlertInput): Promise<ApiResponse<NetworkAlert>> {
  return api<NetworkAlert>("/api/alerts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateAlert(
  id: string,
  input: Partial<AlertInput>,
): Promise<ApiResponse<NetworkAlert>> {
  return api<NetworkAlert>(`/api/alerts/${id}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function deleteAlert(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/alerts/${id}`, { method: "DELETE" });
}
