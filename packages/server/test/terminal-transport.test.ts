

import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  INTERACTIVE_EOL,
  TERMINAL_EOL,
  eolFor,
  resolveCommandOutput,
} from "@/sockets/terminalIO";
import {
  TerminalSessionHub,
  terminalSessionHub,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";
import { SshClient } from "@/client/SshClient";
import { TelnetClient } from "@/client/TelnetClient";
import { SerialPortClient } from "@/client/SerialPortClient";
import { TERMINAL_TOOLS } from "@/agent/tools/TerminalTools";
import { requestContext, type RequestUser } from "@/utils/RequestContext";


function sessionRegistration(
  overrides: Partial<TerminalSessionRegistration> = {},
): TerminalSessionRegistration {
  return {
    socketId: "s1",
    userId: "u1",
    providerId: "p1",
    protocol: "SSH",
    deviceName: "R1",
    fingerprint: null,
    write: () => {},
    isAlive: () => true,
    ...overrides,
  };
}


function userContext(overrides: Partial<RequestUser> = {}): RequestUser {
  return { id: "u1", username: "test", role: "ADMIN", ...overrides };
}


interface InvokableTool {
  name: string;
  invoke: (input: Record<string, unknown>) => Promise<string>;
}


function toolByName(name: string): InvokableTool {
  const encontrada = TERMINAL_TOOLS.find((candidate) => candidate.name === name);
  if (!encontrada) throw new Error(`Tool no encontrada: ${name}`);
  return encontrada as unknown as InvokableTool;
}

describe("EOL por transporte (R9)", () => {
  it("SSH usa CR y Telnet/serie usan CRLF, con el motivo documentado", () => {
    expect(TERMINAL_EOL.SSH).toBe("\r");
    expect(TERMINAL_EOL.TELNET).toBe("\r\n");
    expect(TERMINAL_EOL.SERIAL).toBe("\r\n");
    expect(INTERACTIVE_EOL).toBe("\r");

    expect(eolFor("ssh")).toBe("\r");
    expect(eolFor("Telnet")).toBe("\r\n");
    expect(eolFor(" serial ")).toBe("\r\n");

    expect(eolFor(null)).toBe("\r\n");
  });

  it("el hub escribe el EOL interactivo (CR), no el del transporte", async () => {
    const hub = new TerminalSessionHub();
    const writes: string[] = [];
    try {
      hub.register(
        sessionRegistration({
          protocol: "TELNET",
          write: (data) => {
            writes.push(String(data));
            setTimeout(() => hub.recordData("s1", "\r\nR1# ok\r\n"), 5);
          },
        }),
      );
      hub.recordData("s1", "\r\nR1# ");
      const result = await hub.runCommandsDetailed(hub.get("s1")!, [
        "show version",
      ], { idleMs: 40, maxMs: 500 });

      expect(writes).toEqual(["show version\r"]);
      expect(result.executed).toEqual(["show version"]);
      expect(result.output).toContain("ok");
    } finally {
      hub.clear();
      hub.stopKeepalive();
    }
  });

  it("Telnet directo escribe CRLF (carácter a carácter)", async () => {
    const server = net.createServer((socket) => socket.on("data", () => {}));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;

    const client = new TelnetClient("127.0.0.1", port);
    const escrito: string[] = [];

    (client as unknown as { socket: unknown }).socket = {
      destroyed: false,
      write: (data: string, cb: (err?: Error | null) => void) => {
        escrito.push(data);
        cb();
      },
    };

    try {
      await client.send("show version");
      expect(escrito).toEqual(["show version\r\n"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("la serie directa escribe CRLF (carácter a carácter)", async () => {
    const client = new SerialPortClient("COM9", 9600);
    const escrito: string[] = [];
    (client as unknown as { client: unknown }).client = {
      isOpen: true,
      write: (data: string, cb: (err?: Error) => void) => {
        escrito.push(data);
        cb();
      },
    };


    await expect(
      client.executeCommand("show version", { idleMs: 50, maxMs: 200 }),
    ).rejects.toThrow(/Tiempo agotado/);
    expect(escrito[0]).toBe("show version\r\n");
  });
});

describe("TelnetClient ruta directa: idle + tope en vez de read(fijo)", () => {
  let server: net.Server;
  let port = 0;
  
  let recibidos: string[];
  
  let crudos: string[];

  beforeEach(async () => {
    recibidos = [];
    crudos = [];
    server = net.createServer((socket) => {
      socket.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf-8");
        crudos.push(text);
        for (const line of text.split("\r\n")) {
          const cmd = line.trim();
          if (!cmd) continue;
          recibidos.push(cmd);

          if (cmd === "lento") {
            setTimeout(() => socket.write("LENTO-A\r\n"), 100);
            setTimeout(() => socket.write("LENTO-B\r\n"), 220);
          } else if (cmd !== "silencioso") {

            setTimeout(() => socket.write(`${cmd}-OK\r\n`), 60);
          }
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("la salida del comando lento no se atribuye al siguiente", async () => {
    const client = new TelnetClient("127.0.0.1", port);
    const output = await client.executeCommands(["lento", "rapido"], {
      idleMs: 400,
      maxMs: 3_000,
    });


    expect(output).toContain("LENTO-A");
    expect(output).toContain("LENTO-B");
    expect(output).toContain("rapido-OK");
    expect(output.indexOf("LENTO-A")).toBeLessThan(output.indexOf("rapido-OK"));
    expect(output.indexOf("LENTO-B")).toBeLessThan(output.indexOf("rapido-OK"));

    expect(recibidos).toEqual(["lento", "rapido"]);
    expect(crudos[0]).toBe("lento\r\n");
  });

  it("un comando que no dice nada agota el plazo en vez de devolver vacío + éxito", async () => {
    const client = new TelnetClient("127.0.0.1", port);

    await expect(
      client.executeCommands(["silencioso"], { idleMs: 100, maxMs: 400 }),
    ).rejects.toThrow(/Tiempo agotado|salida vacía/i);
  });

  it("si el equipo cierra sin responder, tampoco se reporta como éxito", async () => {
    const withoutEcho = net.createServer((socket) => socket.destroy());
    await new Promise<void>((resolve) =>
      withoutEcho.listen(0, "127.0.0.1", resolve),
    );
    const portCiego = (withoutEcho.address() as net.AddressInfo).port;

    try {
      const client = new TelnetClient("127.0.0.1", portCiego);
      await expect(
        client.executeCommands(["show version"], { idleMs: 100, maxMs: 2_000 }),
      ).rejects.toThrow(/Salida vacía/);
    } finally {
      await new Promise<void>((resolve) => withoutEcho.close(() => resolve()));
    }
  });
});

describe("SerialPortClient ruta directa: idle + tope en vez de read(5000)", () => {
  
  function clienteFake(trozosByCommand: string[][]) {
    const client = new SerialPortClient("COM9", 9600);
    const writes: string[] = [];
    (client as unknown as { client: unknown }).client = {
      isOpen: true,
      write: (data: string, cb: (err?: Error) => void) => {
        writes.push(data);
        const trozos = trozosByCommand[writes.length - 1] ?? [];
        trozos.forEach((trozo, index) => {
          setTimeout(() => {
            (client as unknown as { buffer: string }).buffer += trozo;
          }, 100 + index * 120);
        });
        cb();
      },
    };
    return { client, writes };
  }

  it("espera a que la salida se calle y escribe el EOL de serie", async () => {
    const { client, writes } = clienteFake([
      ["R1#show version\r\n", "Version 15.2\r\nR1# "],
    ]);

    const output = await client.executeCommand("show version", {
      idleMs: 400,
      maxMs: 2_000,
    });


    expect(writes[0]).toBe("show version\r\n");

    expect(output).toContain("Version 15.2");
    expect(output).toContain("R1# ");
  });

  it("sin respuesta del puerto no devuelve vacío + éxito", async () => {
    const { client } = clienteFake([[]]);

    await expect(
      client.executeCommand("show version", { idleMs: 100, maxMs: 400 }),
    ).rejects.toThrow(/Tiempo agotado/);
  });

  it("bloquea el cierre de sesión del usuario antes de escribir", async () => {
    const { client, writes } = clienteFake([["ok"]]);

    await expect(client.executeCommand("exit")).rejects.toThrow(
      /bloqueados por seguridad/i,
    );
    expect(writes).toHaveLength(0);
  });
});

describe("R11: nada de vacío + éxito y descartes propagados", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("resolveCommandOutput lanza si no se ejecutó nada y avisa de los descartes", () => {
    expect(() =>
      resolveCommandOutput(
        { output: "", executed: [], removed: ["exit"], elapsedMs: 10 },
        { destino: "10.0.0.1:22", transport: "SSH" },
      ),
    ).toThrow(/No se ejecutó ningún comando/);

    expect(() =>
      resolveCommandOutput(
        { output: "   ", executed: ["show version"], removed: [], elapsedMs: 10 },
        { destino: "10.0.0.1:22", transport: "SSH" },
      ),
    ).toThrow(/Salida vacía/);


    const output = resolveCommandOutput(
      {
        output: "Version 15.2",
        executed: ["show version"],
        removed: ["exit"],
        elapsedMs: 10,
      },
      { destino: "10.0.0.1:22", transport: "SSH" },
    );
    expect(output).toContain("Version 15.2");
    expect(output).toContain("exit");
  });

  it("runCommandsDetailed propaga executed y removed", async () => {
    hub.register(
      sessionRegistration({
        write: () => {
          setTimeout(() => hub.recordData("s1", "\r\nR1# Version 15.2\r\n"), 5);
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.runCommandsDetailed(hub.get("s1")!, [
      "show version",
      "exit",
    ], { idleMs: 40, maxMs: 500 });

    expect(result.executed).toEqual(["show version"]);
    expect(result.removed).toEqual(["exit"]);
    expect(result.removedReason).toMatch(/cerraría la sesión interactiva/);
    expect(result.output).toContain("Version 15.2");
    expect(result.endReason).toBe("idle");
    expect(result.timedOut).toBe(false);
  });

  it("un lote en blanco no ejecuta nada y no finge un envío correcto", async () => {
    hub.register(sessionRegistration());
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.runCommandsDetailed(hub.get("s1")!, ["   "], {
      idleMs: 40,
      maxMs: 200,
    });

    expect(result.executed).toEqual([]);
    expect(result.output).toBe("");
    expect(result.endReason).toBe("idle");
  });

  it("un lote solo de cierre se bloquea con motivo de seguridad", async () => {
    hub.register(sessionRegistration());
    hub.recordData("s1", "\r\nR1# ");

    await expect(
      hub.runCommandsDetailed(hub.get("s1")!, ["exit", "logout"], {
        idleMs: 40,
        maxMs: 200,
      }),
    ).rejects.toThrow(/bloqueados por seguridad/i);
  });

  it("send_command no reporta éxito cuando no se ejecutó nada", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("send_command").invoke({ command: "   " }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.code).toBe("NO_COMMANDS_EXECUTED");
    expect(output.output).toBe("");
    expect(String(output.message)).toMatch(/vacío|en blanco/i);
  });

  it("send_command no reporta éxito cuando la consola no devuelve nada", async () => {

    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("send_command").invoke({
          command: "show version",
          timeoutMs: 300,
        }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.code).toBe("NO_OUTPUT");
    expect(output.executed).toEqual(["show version"]);
    expect(output.timedOut).toBe(true);
  });

  it("send_command expone los comandos descartados y avisa de la salida incompleta", async () => {
    terminalSessionHub.register(
      sessionRegistration({
        socketId: "s1",
        write: () => {
          setTimeout(() => terminalSessionHub.recordData("s1", "\r\nR1# ok\r\n"), 5);
        },
      }),
    );
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("send_command").invoke({
          command: "show version\nexit",
          timeoutMs: 500,
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.executed).toEqual(["show version"]);
    expect(output.removed).toEqual(["exit"]);
    expect(output.removedReason).toMatch(/cerraría la sesión interactiva/);
    expect(String(output.warning)).toMatch(/No se enviaron 1 comando/);
    expect(output.output).toContain("ok");
  });

  it("SshClient enrutado por la consola del usuario devuelve el aviso de descartes", async () => {
    terminalSessionHub.register(
      sessionRegistration({
        socketId: "s1",
        protocol: "SSH",
        providerId: "p1",
        write: () => {
          setTimeout(() => terminalSessionHub.recordData("s1", "\r\nR1# ok\r\n"), 5);
        },
      }),
    );
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = await requestContext.run(userContext(), () =>
      new SshClient("10.0.0.1", 22, "admin", "clave", undefined, "p1")
        .executeCommands(["show version", "exit"]),
    );

    expect(output).toContain("ok");
    expect(output).toContain("exit");
    expect(output).toMatch(/No se enviaron 1 comando/);
  });
});
