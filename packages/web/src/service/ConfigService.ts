import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface SystemConfig {
  id: string;
  systemPrompt: string;

  agentLogsEnabled?: boolean;
}

export interface AgentLogsConfig {
  agentLogsEnabled: boolean;
}

export interface ModelProvider {
  id: string;
  name: string;
  provider: string;
  modelName: string;
  typeModel: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  temperature: number | null;
  isActive: boolean;
  userPermission: string | null;
}

export interface ModelProviderInput {
  id?: string;
  name: string;
  provider?: string;
  modelName: string;
  typeModel?: string | null;
  baseUrl?: string | null;
  apiKey?: string | null;
  temperature?: number;
  isActive?: boolean;
  userPermission?: string;
}

export function getConfig(): Promise<ApiResponse<SystemConfig>> {
  return api<SystemConfig>("/api/config");
}

export function updateSystemPrompt(
  systemPrompt: string,
): Promise<ApiResponse<SystemConfig>> {
  return api<SystemConfig>("/api/config", {
    method: "PUT",
    body: JSON.stringify({ systemPrompt }),
  });
}

export function getModelProviders(): Promise<ApiResponse<ModelProvider[]>> {
  return api<ModelProvider[]>("/api/config/models");
}

export function updateAgentLogsEnabled(
  agentLogsEnabled: boolean,
): Promise<ApiResponse<AgentLogsConfig>> {
  return api<AgentLogsConfig>("/api/config/logs", {
    method: "PUT",
    body: JSON.stringify({ agentLogsEnabled }),
  });
}

export function getAvailableModels(): Promise<ApiResponse<ModelProvider[]>> {
  return api<ModelProvider[]>("/api/config/available-models");
}

export async function saveModelProvider(
  input: ModelProviderInput,
): Promise<ApiResponse<ModelProvider>> {
  const { id, ...payload } = input;

  if (id) {
    return api<ModelProvider>(`/api/config/models/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  return api<ModelProvider>("/api/config/models", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteModelProvider(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/config/models/${id}`, { method: "DELETE" });
}

export interface TestModelProviderInput {
  id?: string;
  provider: string;
  modelName: string;
  typeModel?: string | null;
  baseUrl?: string;
  apiKey?: string;
  temperature?: number;
}

export interface TestModelProviderData {
  ok: boolean;
  latencyMs: number;
  provider: string;
  model: string;
}

export function testModelProvider(
  payload: TestModelProviderInput,
): Promise<ApiResponse<TestModelProviderData>> {
  return api<TestModelProviderData>("/api/config/models/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
