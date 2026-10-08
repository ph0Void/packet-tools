

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TerminalSessionHub,
  promptSatisfies,
  terminalSessionHub,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";
import { getVendorProfile } from "@/agent/security/VendorProfile";
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

describe("promptSatisfies: coincidencia por perfil, no por subcadena", () => {
  const cisco = getVendorProfile("cisco");

  it("sin expected basta con que haya prompt (semántica de siempre)", () => {
    expect(promptSatisfies(cisco, "R1#")).toBe(true);
    expect(promptSatisfies(cisco, "")).toBe(false);
    expect(promptSatisfies(cisco, null)).toBe(false);
  });

  it("un fragmento casa como token completo o al final del prompt", () => {
    expect(promptSatisfies(cisco, "R1#", "R1")).toBe(true);
    expect(promptSatisfies(cisco, "R1(config)#", "R1")).toBe(true);
    expect(promptSatisfies(getVendorProfile("huawei"), "<R1>", "R1")).toBe(true);
    expect(promptSatisfies(cisco, "R1(config)#", "config")).toBe(true);
  });

  it("no acepta un host que es subcadena de otro (R1 dentro de core-r1)", () => {
    expect(promptSatisfies(cisco, "core-r1#", "R1")).toBe(false);
    expect(promptSatisfies(cisco, "core-r1(config)#", "R1")).toBe(false);

    expect(promptSatisfies(cisco, "core-r1#", "core-r1")).toBe(true);
  });

  it("un expected con forma de prompt tiene que ser el prompt entero", () => {
    expect(promptSatisfies(cisco, "R1(config)#", "R1#")).toBe(false);
    expect(promptSatisfies(cisco, "R1#", "R1#")).toBe(true);
    expect(promptSatisfies(cisco, "R1(config)#", "R1(config)#")).toBe(true);

    expect(
      promptSatisfies(
        getVendorProfile("huawei"),
        "[R1-GigabitEthernet0/0]",
        "[R1]",
      ),
    ).toBe(false);

    expect(
      promptSatisfies(
        getVendorProfile("mikrotik"),
        "[admin@host] /interface",
        "[admin@host] /interface",
      ),
    ).toBe(true);
    expect(
      promptSatisfies(
        getVendorProfile("mikrotik"),
        "[admin@host] /interface",
        "[admin@host]",
      ),
    ).toBe(false);
  });
});

describe("Hub: sub-modo según el vendor resuelto", () => {
  let hub: TerminalSessionHub;
  
  let writes: string[];

  beforeEach(() => {
    hub = new TerminalSessionHub();
    writes = [];
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  
  function mockconsoleWithPrompt(promptInicial: string) {
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          setTimeout(() => hub.recordData("s1", `\r\nok\r\n${promptInicial}`), 5);
        },
      }),
    );
    hub.recordData("s1", `\r\n${promptInicial}`);
    return hub.get("s1")!;
  }

  it("Cisco: (config)# sigue siendo sub-modo y el exit se envía (regresión)", async () => {
    const session = mockconsoleWithPrompt("R1(config)#");

    const result = await hub.sendCommandDetailed(session, "exit", {
      idleMs: 40,
      maxMs: 500,
    });

    expect(result.executed).toEqual(["exit"]);
    expect(result.removed).toEqual([]);
    expect(result.vendor).toBe("cisco");
    expect(writes[0]).toBe("exit\r");
  });

  it("Cisco: el prompt raíz sigue bloqueando el cierre de la consola", async () => {
    const session = mockconsoleWithPrompt("R1#");

    await expect(
      hub.sendCommand(session, "exit", { idleMs: 40, maxMs: 500 }),
    ).rejects.toThrow(/Por seguridad no se envía/);
    expect(writes).toEqual([]);
  });

  it("Huawei: [R1-GigabitEthernet0/0] es sub-modo y el exit se envía", async () => {
    const session = mockconsoleWithPrompt("[R1-GigabitEthernet0/0]");

    const result = await hub.sendCommandDetailed(session, "exit", {
      idleMs: 40,
      maxMs: 500,
    });

    expect(result.executed).toEqual(["exit"]);
    expect(result.vendor).toBe("huawei");
  });

  it("MikroTik: [admin@host] /interface es sub-modo y la transición /exit se envía", async () => {
    const session = mockconsoleWithPrompt("[admin@host] /interface");

    const result = await hub.sendCommandDetailed(session, "/exit", {
      idleMs: 40,
      maxMs: 500,
    });

    expect(result.executed).toEqual(["/exit"]);
    expect(result.vendor).toBe("mikrotik");
  });

  it("MikroTik: /exit en el prompt raíz no cierra la consola del usuario", async () => {
    const session = mockconsoleWithPrompt("[admin@host] >");

    await expect(
      hub.sendCommand(session, "/exit", { idleMs: 40, maxMs: 500 }),
    ).rejects.toThrow(/Por seguridad no se envía/);
    expect(writes).toEqual([]);
  });

  it("el lote mixto conserva el exit de Huawei y descarta solo el cierre real", async () => {
    const session = mockconsoleWithPrompt("[R1-GigabitEthernet0/0]");

    const result = await hub.runCommandsDetailed(
      session,
      ["undo shutdown", "exit", "logout"],
      { idleMs: 40, maxMs: 500 },
    );


    expect(result.executed).toEqual(["undo shutdown", "exit"]);
    expect(result.removed).toEqual(["logout"]);
  });
});

describe("Hub: caché del vendor por sesión", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  it("sin tipo declarado ni prompt concluyente usa el perfil conservador", () => {
    hub.register(sessionRegistration());
    hub.recordData("s1", "\r\nR1# ");

    expect(hub.getSnapshot("s1")?.vendor).toBe("conservative");
  });

  it("el tipo declarado manda aunque el prompt no sea concluyente", () => {
    hub.register(sessionRegistration({ typeDevice: "MIKROTIK" }));
    hub.recordData("s1", "\r\nRouterOS 7.1 (stable)\r\n");

    expect(hub.getSnapshot("s1")?.vendor).toBe("mikrotik");
  });

  it("el prompt identifica el vendor y el perfil se conserva al salir de la vista", async () => {
    hub.register(sessionRegistration({ write: () => {} }));
    hub.recordData("s1", "\r\nR1(config)# ");


    expect(hub.getSnapshot("s1")?.vendor).toBe("cisco");


    hub.recordData("s1", "\r\nBuilding configuration...\r\nCurrent configuration");
    expect(hub.getSnapshot("s1")?.vendor).toBe("cisco");


    hub.recordData("s1", "\r\nR1# ");
    expect(hub.getSnapshot("s1")?.vendor).toBe("cisco");


    hub.recordData("s1", "\r\n[R1-GigabitEthernet0/0]");
    expect(hub.getSnapshot("s1")?.vendor).toBe("huawei");


    hub.recordData("s1", "\r\n 0 chain: H/W\nexample.com\n");
    expect(hub.getSnapshot("s1")?.vendor).toBe("huawei");


    hub.recordData("s1", "\r\n[admin@host] /interface bridge");
    expect(hub.getSnapshot("s1")?.vendor).toBe("mikrotik");


    await hub.runCommandsDetailed(hub.get("s1")!, ["show version"], {
      idleMs: 40,
      maxMs: 200,
    });
    expect(hub.getSnapshot("s1")?.vendor).toBe("mikrotik");
  });

  it("un registro nuevo empieza sin vendor cacheado", () => {
    hub.register(sessionRegistration({ socketId: "s1", typeDevice: "CISCO" }));
    expect(hub.getSnapshot("s1")?.vendor).toBe("cisco");

    hub.register(sessionRegistration({ socketId: "s2" }));
    hub.recordData("s2", "\r\nR1# ");
    expect(hub.getSnapshot("s2")?.vendor).toBe("conservative");
  });
});

describe("Hub: waitForPrompt con fragmento de host", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  it("esperando R1 no da por buena la línea de core-r1", async () => {
    hub.register(sessionRegistration());
    hub.recordData("s1", "\r\ncore-r1# ");
    const session = hub.get("s1")!;

    const snapshot = await hub.waitForPrompt(session, {
      expected: "R1",
      timeoutMs: 250,
    });

    expect(snapshot.prompt).toBe("core-r1#");

    expect(snapshot.promptWaitMessage).toMatch(/se esperaba "R1"/);
    expect(snapshot.promptWaitMessage).toMatch(/"core-r1#"/);
  });

  it("esperando R1 sí acepta el prompt de R1 en sub-modo", async () => {
    hub.register(sessionRegistration());
    hub.recordData("s1", "\r\nR1(config)# ");
    const session = hub.get("s1")!;

    const snapshot = await hub.waitForPrompt(session, {
      expected: "R1",
      timeoutMs: 250,
    });

    expect(snapshot.prompt).toBe("R1(config)#");
    expect(snapshot.promptWaitMessage).toBeNull();
  });

  it("sin expected mantiene la semántica de siempre", async () => {
    hub.register(sessionRegistration());
    hub.recordData("s1", "\r\ncore-r1# ");
    const session = hub.get("s1")!;

    const snapshot = await hub.waitForPrompt(session, { timeoutMs: 250 });

    expect(snapshot.prompt).toBe("core-r1#");
    expect(snapshot.promptWaitMessage).toBeNull();
  });

  it("el mensaje de timeout también dice qué espera el equipo", async () => {
    hub.register(sessionRegistration());
    hub.recordData("s1", "\r\nConfirm? [confirm]\r\n");
    const session = hub.get("s1")!;

    const snapshot = await hub.waitForPrompt(session, {
      expected: "R1",
      timeoutMs: 250,
    });

    expect(snapshot.prompt).toBeNull();
    expect(snapshot.promptWaitMessage).toMatch(/ninguno/);
    expect(snapshot.promptWaitMessage).toMatch(/\[confirm\]/);
  });
});

describe("Hub: pre-flight de prompt", () => {
  let hub: TerminalSessionHub;
  
  let writes: string[];

  beforeEach(() => {
    hub = new TerminalSessionHub();
    writes = [];
  });

  afterEach(() => {
    hub.clear();
    hub.stopKeepalive();
  });

  
  function mockconsoleWithoutTeam() {
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
        },
      }),
    );
    return hub.get("s1")!;
  }

  it("sin prompt no envía nada y devuelve el motivo con la última línea", async () => {
    const session = mockconsoleWithoutTeam();

    hub.recordData("s1", "\r\nCargando configuracion...");

    await expect(
      hub.runCommandsDetailed(session, ["show version"], {
        idleMs: 40,
        maxMs: 300,
      }),
    ).rejects.toThrow(/no tiene un prompt listo/);
    expect(writes).toEqual([]);
  });

  it("el motivo del pre-flight nombra la respuesta que espera el equipo", async () => {
    const session = mockconsoleWithoutTeam();
    hub.recordData("s1", "\r\nuser@R1's password: ");

    await expect(
      hub.runCommandsDetailed(session, ["show version"], {
        idleMs: 40,
        maxMs: 300,
      }),
    ).rejects.toThrow(/password/);
    expect(writes).toEqual([]);
  });

  it("con prompt en consola envía normal", async () => {
    const session = mockconsoleWithoutTeam();
    hub.recordData("s1", "\r\nR1# ");
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          setTimeout(() => hub.recordData("s1", "\r\nVersion 15.2\r\nR1# "), 5);
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.runCommandsDetailed(hub.get("s1")!, ["show version"], {
      idleMs: 40,
      maxMs: 500,
    });

    expect(result.executed).toEqual(["show version"]);
    expect(result.output).toContain("Version 15.2");

    expect(result.preflightWaitMs).toBeLessThanOrEqual(50);
  });

  it("espera a que aparezca el prompt y luego envía", async () => {
    const session = mockconsoleWithoutTeam();
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          setTimeout(() => hub.recordData("s1", "\r\nok\r\nR1# "), 5);
        },
      }),
    );

    setTimeout(() => hub.recordData("s1", "\r\nCargando...\r\nR1# "), 250);

    const result = await hub.runCommandsDetailed(hub.get("s1")!, ["show version"], {
      idleMs: 40,
      maxMs: 2_000,
    });

    expect(result.executed).toEqual(["show version"]);
    expect(result.output).toContain("ok");
    expect(writes).toEqual(["show version\r"]);
    expect(result.preflightWaitMs).toBeGreaterThanOrEqual(200);
  });

  it("preflight:false desactiva la comprobación (login en curso)", async () => {
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          setTimeout(() => hub.recordData("s1", "\r\nWelcome\r\nR1# "), 5);
        },
      }),
    );

    const result = await hub.runCommandsDetailed(
      hub.get("s1")!,
      ["admin"],
      { idleMs: 40, maxMs: 500, preflight: false },
    );

    expect(result.executed).toEqual(["admin"]);
    expect(result.output).toContain("Welcome");
    expect(result.preflightWaitMs).toBe(0);
  });

  it("una consola registrada con preflight:false no exige prompt", async () => {
    hub.register(sessionRegistration({ preflight: false, write: (data) => {
      const text = String(data);
      writes.push(text);
    } }));

    const result = await hub.runCommandsDetailed(hub.get("s1")!, ["admin"], {
      idleMs: 40,
      maxMs: 300,
    });

    expect(result.executed).toEqual(["admin"]);
  });

  it("no le pelea la consola al usuario que está tecleando", async () => {
    const session = mockconsoleWithoutTeam();

    hub.noteUserInput("s1");
    hub.recordData("s1", "\r\nmiguel@equipo:~$ ");

    const result = await hub.runCommandsDetailed(session, ["uptime"], {
      idleMs: 40,
      maxMs: 300,
    });

    expect(result.executed).toEqual(["uptime"]);
  });

  it("el presupuesto del pre-flight no excede el plazo del llamante", async () => {
    const session = mockconsoleWithoutTeam();
    const start = Date.now();

    await expect(
      hub.runCommandsDetailed(session, ["show version"], {
        idleMs: 40,
        maxMs: 200,
      }),
    ).rejects.toThrow(/no tiene un prompt listo/);

    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it("setPreflightDefault(false) relaja todo el hub", async () => {
    const session = mockconsoleWithoutTeam();
    hub.setPreflightDefault(false);
    try {
      const result = await hub.runCommandsDetailed(session, ["admin"], {
        idleMs: 40,
        maxMs: 300,
      });
      expect(result.executed).toEqual(["admin"]);
    } finally {
      hub.setPreflightDefault(true);
    }
  });
});

describe("TerminalTools: el vendor resuelto llega al payload", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("read_terminal expone el vendor detectado por el prompt de la consola", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData("s1", "\r\n[admin@MikroTik] /interface bridge");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("read_terminal").invoke({ lines: 5 }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.vendor).toBe("mikrotik");
  });

  it("get_terminal_status expone el vendor de una vista de Huawei", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData("s1", "\r\n[R1-GigabitEthernet0/0]");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("get_terminal_status").invoke({}),
      ),
    );

    expect(output.alive).toBe(true);
    expect(output.vendor).toBe("huawei");
  });

  it("send_command informa del pre-flight sin escribir nada", async () => {
    const escritas: string[] = [];
    terminalSessionHub.register(
      sessionRegistration({
        socketId: "s1",
        write: (data) => {
          escritas.push(String(data));
        },
      }),
    );
    terminalSessionHub.recordData("s1", "\r\nCargando configuracion...");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("send_command").invoke({
          command: "show version",
          timeoutMs: 300,
        }),
      ),
    );

    expect(output.success).toBe(false);
    expect(String(output.message)).toMatch(/prompt listo/);
    expect(String(output.message)).toContain("Cargando configuracion...");
    expect(escritas).toEqual([]);
  });
});
