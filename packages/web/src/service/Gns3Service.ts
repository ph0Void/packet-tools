"use server";

import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface Gns3Project {
  project_id: string;
  name: string;
  status: string;
  filename?: string | null;
}

export interface Gns3ProjectSummary {
  project_id: string;
  name: string;
  status: string;
}

export interface Gns3Node {
  node_id: string;
  name: string;
  node_type: string;
  status: string;
  x: number | null;
  y: number | null;
  console_host?: string | null;
  console?: number | null;
  console_type?: string | null;
}

export interface Gns3LinkEndpoint {
  node_id: string;
  adapter_number?: number | null;
  port_number?: number | null;
}

export interface Gns3Link {
  link_id: string;
  nodes: Gns3LinkEndpoint[];
}

export interface Gns3Topology {
  project: Gns3ProjectSummary;
  nodes: Gns3Node[];
  links: Gns3Link[];
}

export async function getGns3Projects(): Promise<ApiResponse<Gns3Project[]>> {
  return api<Gns3Project[]>("/api/gns3/projects");
}

export async function getGns3Topology(
  projectId: string,
): Promise<ApiResponse<Gns3Topology>> {
  return api<Gns3Topology>(
    `/api/gns3/projects/${encodeURIComponent(projectId)}/topology`,
  );
}
