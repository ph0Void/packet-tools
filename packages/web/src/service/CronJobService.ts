import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface CronJob {
  id: string;
  name: string;
  description: string | null;
  prompt: string | null;
  cronExpression: string | null;
  scheduledAt: string | null;
  actionType: "STANDARD" | "INTELLIGENT";

  payload: string | null;
  isActive: boolean;
  deviceProviderId: string | null;
  topologyId: string | null;
  createdAt: string;
  topology?: { id: string; name: string } | null;
  deviceProvider?: { id: string; name: string } | null;
}

export interface CronJobInput {
  id?: string;
  name: string;
  description?: string | null;
  prompt?: string | null;
  cronExpression?: string;
  scheduledAt?: string;
  actionType: "STANDARD" | "INTELLIGENT";
  config?: Record<string, unknown> | null;
  isActive?: boolean;
  deviceProviderId?: string | null;
  topologyId?: string | null;
}

function toPayload(input: CronJobInput): Record<string, unknown> {
  const { config, ...rest } = input;
  return {
    ...rest,
    payload:
      config && Object.keys(config).length > 0 ? JSON.stringify(config) : null,
  };
}

export function getJobs(): Promise<ApiResponse<CronJob[]>> {
  return api<CronJob[]>("/api/jobs");
}

export async function saveJob(
  input: CronJobInput,
): Promise<ApiResponse<CronJob>> {
  const body = toPayload(input);

  if (input.id) {
    return api<CronJob>(`/api/jobs/${input.id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  return api<CronJob>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteJob(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/jobs/${id}`, { method: "DELETE" });
}

export interface CronJobRunResult {
  jobId: string;
  nombre: string;

  ejecutado: boolean;
  ok: boolean;

  error?: string;
  duracionMs: number;
  salida?: string;

  status: string | null;
  isActive: boolean | null;
  nextRun: string | null;
}

export function runJob(id: string): Promise<ApiResponse<CronJobRunResult>> {
  return api<CronJobRunResult>(`/api/jobs/${id}/run`, { method: "POST" });
}

function parseConfig(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function setJobActive(
  id: string,
  isActive: boolean,
): Promise<ApiResponse<CronJob>> {
  const current = await getJobs();
  const job = current.data?.find((item) => item.id === id);

  if (!job) {
    return {
      success: false,
      message: "Tarea programada no encontrada.",
      data: null,
    };
  }

  return saveJob({
    id: job.id,
    name: job.name,
    description: job.description,
    prompt: job.prompt,
    ...(job.cronExpression ? { cronExpression: job.cronExpression } : {}),
    ...(job.scheduledAt ? { scheduledAt: job.scheduledAt } : {}),
    actionType: job.actionType,
    config: parseConfig(job.payload),
    isActive,
    deviceProviderId: job.deviceProviderId,
    topologyId: job.topologyId,
  });
}
