import { api, type ApiResponse } from "@/service/client/ApiClient";

export interface DeviceProvider {
  id: string;
  name: string;
  typeDevice: string;
  protocol: string;
  host: string | null;
  port: number | null;
  serialPort: string | null;
  serialBaudrate: number | null;
  username: string | null;
  password: string | null;
  status: string;

  isTemporary?: boolean;
}

export type DeviceProviderInput = Partial<Omit<DeviceProvider, "id">>;

export function getDevices(): Promise<ApiResponse<DeviceProvider[]>> {
  return api<DeviceProvider[]>("/api/devices");
}

export async function saveDevice(
  input: DeviceProviderInput & { id?: string },
): Promise<ApiResponse<DeviceProvider>> {
  const { id, ...payload } = input;

  if (id) {
    return api<DeviceProvider>(`/api/devices/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  return api<DeviceProvider>("/api/devices", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteDevice(id: string): Promise<ApiResponse<null>> {
  return api<null>(`/api/devices/${id}`, { method: "DELETE" });
}

export interface DeviceTestInput {
  providerId?: string;
  typeDevice?: string;
  protocol?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  serialPort?: string;
  serialBaudrate?: number;
}

export interface DeviceTestResult {
  typeDevice?: string;
  protocol?: string;
  status?: number | null;
  version?: string | null;
  latencyMs?: number | null;
}

export function testDeviceConnection(
  input: DeviceTestInput,
): Promise<ApiResponse<DeviceTestResult>> {
  return api<DeviceTestResult>("/api/devices/test", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
