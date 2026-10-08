import type { Socket } from "socket.io";

class SimulationBridge {
  private socket: Socket | null = null;

  attach(socket: Socket): void {
    this.socket = socket;
  }

  detach(socketId: string): void {
    if (this.socket?.id === socketId) this.socket = null;
  }

  get current(): Socket | null {
    return this.socket && this.socket.connected ? this.socket : null;
  }

  get isPacketTracerConnected(): boolean {
    return this.current !== null;
  }

  clearForTests(): void {
    this.socket = null;
  }
}

export const simulationBridge = new SimulationBridge();
