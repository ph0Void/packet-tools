


export type ProtocoloTransporte = "SSH" | "TELNET" | "SERIAL";


export interface OpcionesConexion {
  protocol: ProtocoloTransporte;
  
  host?: string | null;
  
  port?: number | null;
  
  serialPort?: string | null;
  
  baudRate?: number | null;

  username?: string | null;
  password?: string | null;
  
  privateKey?: string | null;

  
  providerId?: string | null;

  
  typeDevice?: string | null;
}


export interface ResultadoComando {
  
  output: string;
  
  prompt: string | null;
  
  vendorId: string;
  
  vendorLabel: string;
  
  vendorDetectado: boolean;
  
  duracionMs: number;
}


export interface DeviceTransport {
  
  readonly protocol: ProtocoloTransporte;
  
  isConnected(): boolean;

  
  connect(): Promise<void>;
  
  disconnect(): Promise<void>;

  
  sendCommand(command: string): Promise<void>;

  
  readOutput(options?: { idleMs?: number; maxMs?: number }): Promise<string>;
}


export interface OpcionesEjecucion {
  idleMs?: number;
  maxMs?: number;
  
  vendorIdForzado?: string | null;
  
  sinPreambulo?: boolean;
}
