export interface DeviceInterface {
  name: string;
  ipAddress?: string;
  subnetMask?: string;
  isUp: boolean;
  macAddress?: string;
  connectedTo?: {
    deviceName: string;
    interfaceName: string;
  };
}

export type DeviceType =
  | "router"
  | "switch"
  | "pc"
  | "server"
  | "cloud_hub"
  | "wireless"
  | "voip"
  | "infrastructure"
  | "security"
  | "iot"
  | "unknown";

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  model: string;
  x: number;
  y: number;
  status: "online" | "offline" | "error";
  power: boolean;
  interfaces: DeviceInterface[];
  gateway?: string;
}

export interface Link {
  id: string;
  sourceDevice: string;
  sourceInterface: string;
  targetDevice: string;
  targetInterface: string;
  type: string;
  status: "up" | "down";
}

export interface Topology {
  devices: Device[];
  links: Link[];
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending_permission" | "running" | "completed" | "denied" | "error";
  output?: string;
}

export interface TextBlock {
  type: "text";
  content: string;
}

export interface ToolBlock {
  type: "tool";
  id: string;
  name: string;
  input: Record<string, unknown>;
  status: "running" | "waiting_approval" | "completed" | "rejected";
  output?: string;
}

export type MessageContentBlock = TextBlock | ToolBlock;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  contentBlocks?: MessageContentBlock[];
  createdAt: Date | string;
  attachments?: string[];
  toolCalls?: ToolCall[];
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: Date | string;
  messages: ChatMessage[];
  topology: Topology;
}

export interface DashboardStats {
  totalDevices: number;
  routers: number;
  switches: number;
  pcs: number;
  servers: number;
  disconnectedDevices: number;
  failuresDetected: number;
  websocketStatus: "connected" | "connecting" | "disconnected";
}
