import { Device, Link } from "@/types";

export interface ParsedTopology {
  devices: Device[];
  links: Link[];
}

const EMPTY_TOPOLOGY: ParsedTopology = { devices: [], links: [] };

export function parseTopologyJson(
  topologyJson: string | null | undefined
): ParsedTopology {
  if (!topologyJson) return EMPTY_TOPOLOGY;

  try {
    const parsed: unknown = JSON.parse(topologyJson);
    if (!parsed || typeof parsed !== "object") return EMPTY_TOPOLOGY;

    const candidate = parsed as Partial<ParsedTopology>;
    return {
      devices: Array.isArray(candidate.devices)
        ? (candidate.devices as Device[])
        : [],
      links: Array.isArray(candidate.links) ? (candidate.links as Link[]) : [],
    };
  } catch (error) {
    console.error("Error al analizar topologyJson:", error);
    return EMPTY_TOPOLOGY;
  }
}

interface LiveToolPayload {
  success?: boolean;
  result?: {
    devices?: unknown;
    links?: unknown;
    deviceCount?: number;
    connectionCount?: number;
  };
  devices?: unknown;
  links?: unknown;
}

export function extractLiveTopology(payload: unknown): ParsedTopology {
  const data = (payload ?? {}) as LiveToolPayload;
  const rawDevices = data.result?.devices ?? data.devices;
  const rawLinks = data.result?.links ?? data.links;

  return {
    devices: Array.isArray(rawDevices) ? (rawDevices as Device[]) : [],
    links: Array.isArray(rawLinks) ? (rawLinks as Link[]) : [],
  };
}
