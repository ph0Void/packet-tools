

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


const ssh2Mock = vi.hoisted(() => {
  type Handler = (...args: any[]) => void;

  class Emitter {
    private handlers: Record<string, Handler[]> = {};
    on(event: string, handler: Handler): this {
      (this.handlers[event] ??= []).push(handler);
      return this;
    }
    emit(event: string, ...args: any[]): boolean {
      const listeners = [...(this.handlers[event] ?? [])];
      for (const listener of listeners) listener(...args);
      return listeners.length > 0;
    }
  }

  class FakeStream extends Emitter {
    
    writes: string[] = [];
    ended = false;
    
    closeEmitted = false;

    constructor() {
      super();
      state.streams.push(this);
    }

    write(data: string): boolean {
      this.writes.push(data);
      state.onWrite(this, data);
      return true;
    }

    
    end(data?: string): void {
      if (typeof data === "string" && data.length > 0) this.write(data);
      this.ended = true;
    }

    
    emitClose(): void {
      this.closeEmitted = true;
      this.emit("close");
    }

    
    emitData(text: string): void {
      this.emit("data", Buffer.from(text, "utf-8"));
    }
  }

  class FakeClient extends Emitter {
    stream: FakeStream | null = null;
    connectOptions: Record<string, unknown> | null = null;
    shellError: Error | null = null;
    ended = false;

    connect(options: Record<string, unknown>): this {
      this.connectOptions = options;
      setImmediate(() => this.emit("ready"));
      return this;
    }

    shell(callback: (err: Error | null, stream: FakeStream) => void): this {
      if (this.shellError) {
        setImmediate(() => callback(this.shellError, null as never));
        return this;
      }
      const stream = new FakeStream();
      this.stream = stream;
      setImmediate(() => callback(null, stream));
      return this;
    }

    end(): void {
      this.ended = true;
    }
  }

  const state = {
    streams: [] as FakeStream[],
    
    onWrite: (_stream: FakeStream, _data: string) => {},
  };

  return { FakeClient, FakeStream, state };
});

vi.mock("ssh2", () => ({ Client: ssh2Mock.FakeClient }));

import { SshClient } from "@/client/SshClient";


function lastStream(): InstanceType<typeof ssh2Mock.FakeStream> {
  const stream = ssh2Mock.state.streams[ssh2Mock.state.streams.length - 1];
  if (!stream) throw new Error("El cliente no abrió ningún shell.");
  return stream;
}


function cliente(): SshClient {
  return new SshClient("10.0.0.1", 22, "admin", "clave");
}

describe("SshClient.executeCommands (ruta directa, R4)", () => {
  beforeEach(() => {
    ssh2Mock.state.streams = [];
    ssh2Mock.state.onWrite = () => {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("escribe el EOL de SSH (CR) y resuelve por inactividad aunque el shell nunca se cierre", async () => {
    ssh2Mock.state.onWrite = (stream, data) => {
      if (data.startsWith("show version")) {
        setTimeout(() => stream.emitData("show version\r\nR1# Version 15.2\r\nR1# "), 20);
      }
    };

    const output = await cliente().executeCommands(["show version"], {
      idleMs: 60,
      maxMs: 3_000,
    });

    expect(output).toContain("Version 15.2");
    
    expect(lastStream().writes).toEqual(["show version\r", "exit\r"]);
    
    expect(lastStream().closeEmitted).toBe(false);
  });

  it("corta con el plazo máximo si el equipo no dice nada (antes se colgaba para siempre)", async () => {
    const start = Date.now();
    const promise = cliente().executeCommands(["ping 10.0.0.1"], {
      idleMs: 50,
      maxMs: 300,
    });

    await expect(promise).rejects.toThrow(/Tiempo agotado \(300 ms\)/);
    await expect(promise).rejects.toThrow(/puede seguir ejecutándose en el equipo/);
    
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it("informa del paginador activo en vez de colgarse en silencio", async () => {
    ssh2Mock.state.onWrite = (stream, data) => {
      if (data.startsWith("show run")) {
        setTimeout(() => stream.emitData("show run\r\n!\r\nR1# --More--"), 20);
      }
    };

    const promise = cliente().executeCommands(["show run"], {
      idleMs: 60,
      maxMs: 3_000,
    });

    await expect(promise).rejects.toThrow(/paginador activo \(--More--\)/);
    
    expect(lastStream().writes).toEqual(["show run\r", "exit\r"]);
  });

  it("informa del prompt de contraseña (enable secret) sin resolver con éxito vacío", async () => {
    ssh2Mock.state.onWrite = (stream, data) => {
      if (data.startsWith("enable")) {
        setTimeout(() => stream.emitData("enable\r\nPassword: "), 20);
      }
    };

    await expect(
      cliente().executeCommands(["enable"], { idleMs: 60, maxMs: 3_000 }),
    ).rejects.toThrow(/pide una contraseña \(Password:\)/);
  });

  it("resuelve con la salida capturada cuando el shell se cierra de verdad", async () => {
    ssh2Mock.state.onWrite = (stream, data) => {
      if (data.startsWith("show version")) {
        setTimeout(() => stream.emitData("R1# Version 15.2\r\n"), 10);
        setTimeout(() => stream.emitClose(), 60);
      }
    };

    const output = await cliente().executeCommands(["show version"], {
      idleMs: 400,
      maxMs: 3_000,
    });

    expect(output).toContain("Version 15.2");
    expect(lastStream().closeEmitted).toBe(true);
  });

  it("un fallo de red a mitad rechaza con contexto en vez de quedarse esperando", async () => {
    ssh2Mock.state.onWrite = (stream, data) => {
      if (data.startsWith("show tech-support")) {
        setTimeout(() => stream.emitData("show tech-support\r\n"), 10);
        setTimeout(() => stream.emit("error", new Error("ECONNRESET")), 30);
      }
    };

    const promise = cliente().executeCommands(["show tech-support"], {
      idleMs: 400,
      maxMs: 3_000,
    });

    await expect(promise).rejects.toThrow(/Fallo de red SSH a mitad/);
    await expect(promise).rejects.toThrow(/ECONNRESET/);
    
    await expect(promise).rejects.toThrow(/show tech-support/);
  });

  it("no devuelve vacío + éxito si el shell se cierra sin decir nada", async () => {
    ssh2Mock.state.onWrite = (stream, data) => {
      if (data === "exit\r") setTimeout(() => stream.emitClose(), 20);
    };

    await expect(
      cliente().executeCommands(["show clock"], { idleMs: 60, maxMs: 1_000 }),
    ).rejects.toThrow(/Salida vacía/);
  });

  it("mantiene la sanitización anti-cierre: un lote solo de cierre se bloquea", async () => {
    await expect(
      cliente().executeCommands(["exit"], { idleMs: 60, maxMs: 1_000 }),
    ).rejects.toThrow(/bloqueados por seguridad/i);
  });

  it("mantiene la sanitización anti-cierre: el 'exit' del usuario no se envía", async () => {
    ssh2Mock.state.onWrite = (stream, data) => {
      if (data.startsWith("show version")) {
        setTimeout(() => stream.emitData("show version\r\nR1# Version 15.2\r\n"), 10);
      }
    };

    const output = await cliente().executeCommands(["show version", "exit"], {
      idleMs: 60,
      maxMs: 1_000,
    });

    expect(output).toContain("Version 15.2");
    const writes = lastStream().writes;
    
    expect(writes.filter((data) => data === "exit\r")).toHaveLength(1);
    expect(writes[0]).toBe("show version\r");
  });
});
