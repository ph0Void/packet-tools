

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  classifyCommandRisk,
  classifyCommands,
  isNestedPrompt,
} from "@/agent/security/CommandClassifier";
import { sanitizeCommandsForPrompt } from "@/agent/terminal/sanitizeCommands";
import {
  TerminalSessionHub,
  detectPrompt,
  sanitizeTerminalOutput,
  shouldKeepalive,
  terminalSessionHub,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";
import {
  extractMention,
  extractMentions,
  hasRagMention,
  resolveMention,
} from "@/agent/terminal/MentionParser";
import { buildTerminalSessionBlock } from "@/agent/terminal/SessionContext";
import { createApprovalMiddleware } from "@/agent/approval/ApprovalMiddleware";
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

describe("CommandClassifier (riesgos)", () => {
  it("marca como dangerous los comandos destructivos", () => {
    const destructivos = [
      "reload",
      "write erase",
      "erase startup-config",
      "format flash:",
      "boot system flash:",
    ];
    for (const command of destructivos) {
      expect(classifyCommandRisk(command), command).toBe("dangerous");
    }
  });

  it("considera exit/quit seguros solo dentro de un sub-modo anidado", () => {
    expect(classifyCommandRisk("exit", "R1#")).toBe("sessionControl");
    expect(classifyCommandRisk("exit", "R1(config-if)#")).toBe("safe");
    expect(classifyCommandRisk("quit", "R1(config)#")).toBe("safe");

    expect(classifyCommandRisk("logout", "R1(config)#")).toBe("sessionControl");

    expect(classifyCommandRisk("exit", null)).toBe("sessionControl");
  });

  it("clasifica el lote con exit en prompt raíz como sessionControl", () => {
    const lote = classifyCommands(["show version", "exit"], "R1#");

    expect(lote.level).toBe("config");
    expect(lote.risk).toBe("sessionControl");
    expect(lote.sessionCommands).toContain("exit");
    expect(lote.dangerousCommands).toEqual([]);
  });

  it("no marca sessionControl cuando exit sale de un sub-modo de configuración", () => {
    const lote = classifyCommands(["configure terminal", "exit"], "R1(config)#");

    expect(lote.sessionCommands).toEqual([]);
    expect(lote.risk).toBe("config");
    expect(lote.configCommands).toContain("configure terminal");
  });

  it("isNestedPrompt distingue sub-modos de prompts raíz", () => {
    expect(isNestedPrompt("R1(config-if)#")).toBe(true);
    expect(isNestedPrompt("R1#")).toBe(false);
  });
});

describe("sanitizeCommandsForPrompt", () => {
  it("elimina exit en prompt raíz y conserva el resto", () => {
    const { commands, removed } = sanitizeCommandsForPrompt(
      ["show version", "exit"],
      "R1#",
    );

    expect(commands).toEqual(["show version"]);
    expect(removed).toEqual(["exit"]);
  });

  it("no elimina exit cuando el prompt es un sub-modo anidado", () => {
    const { commands, removed } = sanitizeCommandsForPrompt(
      ["exit"],
      "R1(config-if)#",
    );

    expect(commands).toEqual(["exit"]);
    expect(removed).toEqual([]);
  });

  it("conserva los comandos dangerous: solo filtra sessionControl", () => {
    const enRaiz = sanitizeCommandsForPrompt(["reload"], "R1#");
    expect(enRaiz.commands).toEqual(["reload"]);
    expect(enRaiz.removed).toEqual([]);

    const enSubMode = sanitizeCommandsForPrompt(["reload"], "R1(config-if)#");
    expect(enSubMode.commands).toEqual(["reload"]);
    expect(enSubMode.removed).toEqual([]);
  });
});

describe("Hub: prompt y filtros", () => {
  it("detecta el prompt de la última línea y limpia secuencias ANSI", () => {
    expect(detectPrompt("...\r\nR1# ")).toBe("R1#");
    expect(detectPrompt("\x1b[0mR1(config)#\x1b[0m")).toBe("R1(config)#");
  });

  it("devuelve null ante estados pendientes (contraseña o paginación)", () => {
    expect(detectPrompt("Password: ")).toBeNull();
    expect(detectPrompt("--More--")).toBeNull();
  });

  it("shouldKeepalive solo con un prompt estable y sin estados pendientes", () => {
    expect(shouldKeepalive("Router# ")).toBe(true);
    expect(shouldKeepalive("Confirm? [confirm]")).toBe(false);
    expect(shouldKeepalive("Password:")).toBe(false);
    expect(shouldKeepalive("texto sin prompt\n")).toBe(false);
  });

  it("sanitizeTerminalOutput descarta el handshake de ssh2 y deja la salida real", () => {
    const limpio = sanitizeTerminalOutput(
      "SSH-2.0-ssh2js1.17.0\nR1#show version\n",
    );

    expect(limpio).not.toContain("SSH-2.0-ssh2js");
    expect(limpio).toContain("show version");
  });
});

describe("Hub: snapshots y comandos", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {

    hub.clear();
    hub.stopKeepalive();
  });

  it("registra salida y expone prompt, últimas líneas y estado vivo", () => {
    hub.register(
      sessionRegistration({
        write: (data) => hub.recordData("s1", String(data)),
      }),
    );

    hub.recordData("s1", "\r\nR1# show version\r\nVersion 15.2\r\nR1# ");

    const snapshot = hub.getSnapshot("s1");
    expect(snapshot).not.toBeNull();
    expect(snapshot!.prompt).toBe("R1#");
    expect(snapshot!.alive).toBe(true);
    expect(snapshot!.lastLines.join("\n")).toContain("show version");
  });

  it("getActiveSnapshot solo resuelve con una única sesión viva", () => {
    hub.register(sessionRegistration({ socketId: "s1" }));
    expect(hub.getActiveSnapshot("u1")?.sessionId).toBe("s1");
    expect(hub.listSessions("u1")).toHaveLength(1);


    hub.register(sessionRegistration({ socketId: "s2" }));
    expect(hub.getActiveSnapshot("u1")).toBeNull();
    expect(hub.listSessions("u1")).toHaveLength(2);
  });

  it("sendCommand bloquea el cierre de la consola en prompt raíz", async () => {
    hub.register(sessionRegistration());
    hub.recordData("s1", "\r\nR1# ");
    const session = hub.get("s1")!;

    await expect(hub.sendCommand(session, "exit")).rejects.toThrow(
      /seguridad|bloquead/i,
    );
  });

  it("sendCommand resuelve con la salida capturada del comando", async () => {
    hub.register(
      sessionRegistration({
        write: (data) => {

          setTimeout(
            () => hub.recordData("s1", `\r\n${data}\r\nVersion 15.2\r\nR1# `),
            10,
          );
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");
    const session = hub.get("s1")!;

    const output = await hub.sendCommand(session, "show version", {
      idleMs: 60,
      maxMs: 1000,
    });
    expect(output).toContain("Version 15.2");
  });

  it("waitForPrompt resuelve con el prompt cuando llega dentro del timeout", async () => {
    hub.register(sessionRegistration());
    const session = hub.get("s1")!;

    setTimeout(() => hub.recordData("s1", "\r\nR1# "), 100);
    const snapshot = await hub.waitForPrompt(session, { timeoutMs: 800 });

    expect(snapshot.prompt).toBe("R1#");

  });
});

describe("MentionParser", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("extrae la primera mención @token del mensaje", () => {
    expect(extractMention("revisa @R1 por favor")).toBe("R1");
    expect(extractMention("sin mencion")).toBeNull();
  });

  it("resuelve la mención contra una sesión abierta del usuario", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));

    const result = await resolveMention("@R1 muestra la tabla", "u1");

    expect(result.token).toBe("R1");
    expect(result.sessionId).toBe("s1");
    expect(result.deviceName).toBe("R1");
  });

  it("devuelve solo el token cuando no existe sesión ni proveedor", async () => {
    const result = await resolveMention("@NO-EXISTE", "u1");

    expect(result.token).toBe("NO-EXISTE");
    expect(result.sessionId).toBeNull();
    expect(result.providerId).toBeNull();
    expect(result.deviceName).toBeNull();
  });
});

describe("TerminalTools", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("get_terminal_status devuelve la consola activa del usuario", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("get_terminal_status").invoke({}),
      ),
    );

    expect(output.alive).toBe(true);
    expect(output.deviceName).toBe("R1");
    expect(output.sessionId).toBe("s1");
  });

  it("get_terminal_status responde TERMINAL_REQUIRED si la consola es de otro usuario", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));

    const output = JSON.parse(
      await requestContext.run(userContext({ id: "u2" }), () =>
        toolByName("get_terminal_status").invoke({}),
      ),
    );

    expect(output.code).toBe("TERMINAL_REQUIRED");
    expect(output.alive).toBe(false);
  });

  it("read_terminal devuelve las últimas líneas de la consola", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData(
      "s1",
      "\r\nR1# show version\r\nVersion 15.2\r\nR1# ",
    );

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("read_terminal").invoke({ lines: 5 }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.lines.length).toBeGreaterThan(0);
    expect(output.lines.join("\n")).toContain("show version");
  });

  it("send_command captura el bloqueo de seguridad sin lanzar", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("send_command").invoke({ command: "exit" }),
      ),
    );

    expect(output.success).toBe(false);
    expect(String(output.message)).toMatch(/seguridad|bloquead/i);
  });
});

describe("TerminalTools scoping estricto", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("con conexión objetivo sin consola no usa la consola de otro dispositivo", async () => {
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s1", providerId: "p1" }),
    );
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(
        userContext({ connectionProviderId: "p2", connectionName: "R2" }),
        () => toolByName("get_terminal_status").invoke({}),
      ),
    );

    expect(output.code).toBe("TERMINAL_REQUIRED");
    expect(output.alive).toBe(false);
    expect(output.sessionId).toBeNull();
  });

  it("con conexión objetivo viva resuelve exactamente esa consola", async () => {
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s1", providerId: "p1" }),
    );
    terminalSessionHub.register(
      sessionRegistration({
        socketId: "s2",
        providerId: "p9",
        deviceName: "SW9",
      }),
    );
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(
        userContext({ connectionProviderId: "p1" }),
        () => toolByName("get_terminal_status").invoke({}),
      ),
    );

    expect(output.alive).toBe(true);
    expect(output.sessionId).toBe("s1");
    expect(output.deviceName).toBe("R1");
  });

  it("send_command con conexión objetivo sin consola devuelve TERMINAL_REQUIRED", async () => {
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s1", providerId: "p1" }),
    );
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(
        userContext({ connectionProviderId: "p2", connectionName: "R2" }),
        () => toolByName("send_command").invoke({ command: "show version" }),
      ),
    );

    expect(output.success).toBe(false);
    expect(output.code).toBe("TERMINAL_REQUIRED");
    expect(output.suggestedProviderId).toBe("p2");
  });
});

describe("SessionContext conexión sin consola", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("con conexión objetivo sin consola y sin terminalSessionId informa el bloque", () => {
    const block = requestContext.run(
      {
        ...userContext(),
        connectionProviderId: "p2",
        connectionName: "R2",
        connectionProtocol: "SSH",
      },
      () => buildTerminalSessionBlock(),
    );

    expect(block).toContain("Conexión seleccionada sin consola");
  });

  it("con sesión viva y sin terminalContextLines solo trae el encabezado", () => {
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s1", providerId: "p1" }),
    );
    const lines = Array.from(
      { length: 30 },
      (_, index) => `linea-${String(index + 1).padStart(2, "0")}`,
    );
    terminalSessionHub.recordData("s1", `${lines.join("\n")}\n`);

    const block = requestContext.run(
      userContext({ terminalSessionId: "s1" }),
      () => buildTerminalSessionBlock(),
    );


    expect(block).toContain("Estado de la terminal activa");
    expect(block).toContain("R1");
    expect(block).not.toContain("```text");
    expect(block).not.toContain("linea-30");
  });

  it("con terminalContextLines=10 el bloque trae las últimas 10 líneas sanitizadas", () => {
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s1", providerId: "p1" }),
    );
    const lines = Array.from(
      { length: 30 },
      (_, index) => `linea-${String(index + 1).padStart(2, "0")}`,
    );

    terminalSessionHub.recordData("s1", `\x1b[36m${lines.join("\r\n")}\x1b[0m\n`);

    const block = requestContext.run(
      userContext({ terminalSessionId: "s1", terminalContextLines: 10 }),
      () => buildTerminalSessionBlock(),
    );

    expect(block).toContain("Estado de la terminal activa");
    const innerOfFence =
      block.split("```text\n")[1]?.split("\n```")[0] ?? "";
    const linesBlock = innerOfFence
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(linesBlock.length).toBeLessThanOrEqual(10);
    expect(linesBlock).toContain("linea-30");
    expect(linesBlock).not.toContain("linea-01");
    expect(block).not.toContain("\x1b");
  });
});

describe("MentionParser multi-mención @rag", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("extrae todas las menciones en orden de aparición", () => {
    expect(extractMentions("@rag revisa @R1 y @SW1")).toEqual([
      "rag",
      "R1",
      "SW1",
    ]);
    expect(extractMentions("sin menciones")).toEqual([]);
  });

  it("extractMention ignora @rag y devuelve la primera mención de dispositivo", () => {
    expect(extractMention("@rag revisa @R1")).toBe("R1");
    expect(extractMention("@rag solo")).toBeNull();
  });

  it("hasRagMention detecta @rag sin importar mayúsculas", () => {
    expect(hasRagMention("@RAG text")).toBe(true);
    expect(hasRagMention("@rag")).toBe(true);
    expect(hasRagMention("@R1")).toBe(false);
  });

  it("resolveMention combina rag + token + sesión del dispositivo", async () => {
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s1", deviceName: "R1" }),
    );

    const result = await resolveMention("@rag revisa @R1", "u1");

    expect(result.rag).toBe(true);
    expect(result.token).toBe("R1");
    expect(result.sessionId).toBe("s1");
  });
});

describe("ApprovalMiddleware gate conexión sin consola", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  
  function gateRequest() {
    return {
      toolCall: {
        id: "tc-gate-1",
        name: "executeSshCommands",
        args: { commands: ["show version"] },
      },
    };
  }

  it("sin consola viva de la conexión objetivo devuelve TERMINAL_REQUIRED y no ejecuta", async () => {
    const middleware: any = createApprovalMiddleware();
    let llamado = false;
    const handler = async () => {
      llamado = true;
      return "ok";
    };

    const result = await requestContext.run(
      userContext({
        connectionProviderId: "p2",
        connectionName: "R2",
        approvalChannel: { emit: () => {}, chatId: "chat-1" },
      }),
      () => middleware.wrapToolCall(gateRequest(), handler),
    );

    expect(llamado).toBe(false);
    const content = JSON.parse(result.content);
    expect(content.code).toBe("TERMINAL_REQUIRED");
    expect(content.suggestedProviderId).toBe("p2");
  });

  it("con consola viva de la conexión objetivo ejecuta el handler", async () => {
    terminalSessionHub.register(
      sessionRegistration({ socketId: "s1", providerId: "p1" }),
    );
    const middleware: any = createApprovalMiddleware();
    let llamado = false;
    const handler = async () => {
      llamado = true;
      return "ok";
    };

    const result = await requestContext.run(
      userContext({
        connectionProviderId: "p1",
        connectionName: "R1",
        approvalChannel: { emit: () => {}, chatId: "chat-1" },
      }),
      () => middleware.wrapToolCall(gateRequest(), handler),
    );

    expect(llamado).toBe(true);
    expect(result).toBe("ok");
  });
});
