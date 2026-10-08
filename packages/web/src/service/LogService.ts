import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface LogActor {
  id: string;
  username: string;
  role: string;
}

export interface LogEntry {
  id: string;
  title: string;
  content: string;
  level: string;
  createdAt: string;
  topologyId?: string | null;
  userId: string | null;
  chatId: string | null;
  actor: LogActor | null;
}

export interface LogsPage {
  items: LogEntry[];
  total: number;
  page: number;
  limit: number;
}

export interface LogFilters {
  page?: number;
  limit?: number;
  level?: string;
}

export function getLogs(
  filters: LogFilters = {},
): Promise<ApiResponse<LogsPage>> {
  const params = new URLSearchParams();
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.level) params.set("level", filters.level);

  const query = params.toString();
  return api<LogsPage>(`/api/logs${query ? `?${query}` : ""}`);
}

export function getLogLevels(): Promise<ApiResponse<string[]>> {
  return api<string[]>("/api/logs/levels");
}

export function deleteLog(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/logs/${id}`, { method: "DELETE" });
}

export function clearLogs(): Promise<ApiResponse<null>> {
  return api<null>("/api/logs", { method: "DELETE" });
}
