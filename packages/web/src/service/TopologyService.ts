import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface Topology {
  id: string;
  name: string;
  description: string | null;
  topologyJson: string;
  ownerId: string;
  createdAt: string;
}

export interface TopologyInput {
  id?: string;
  name: string;
  description?: string | null;
  topologyJson: string;
}

export function getTopologies(): Promise<ApiResponse<Topology[]>> {
  return api<Topology[]>("/api/topologies");
}

export function getTopology(id: string): Promise<ApiResponse<Topology>> {
  return api<Topology>(`/api/topologies/${id}`);
}

export async function saveTopology(
  input: TopologyInput,
): Promise<ApiResponse<Topology>> {
  const { id, ...payload } = input;

  if (id) {
    return api<Topology>(`/api/topologies/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  return api<Topology>("/api/topologies", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteTopology(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/topologies/${id}`, { method: "DELETE" });
}
