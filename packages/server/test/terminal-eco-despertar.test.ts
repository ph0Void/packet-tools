

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clasificarEsperaDeEntrada,
  recortarPorEco,
} from "@/sockets/terminalIO";
import {
  TerminalSessionHub,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";


function sessionRegistration(
  overrides: Partial<TerminalSessionRegistration> = {},
): TerminalSessionRegistration {
  return {
    socketId: "s1",
    userId: "u1",
    providerId: "p1",
    protocol: "TELNET",
    deviceName: "R1",
    fingerprint: null,
    write: () => {},
    isAlive: () => true,
    ...overrides,
  };
}


function echoRouterOs(prompt: string, command: string): string {
  let acumulado = "";
  let output = "";
  for (const ch of command) {
    acumulado += ch;
    output += `\r[${prompt}] > \x1b[31m${acumulado}\x1b[K\r`;
  }
  return `${output}\r\n`;
}

describe("recortarPorEco: la salida real sin la escalera del eco", () => {
  it("deja solo la salida del comando (el 82 % de basura del MikroTik)", () => {

    const command = "show version";
    const echo = echoRouterOs("admin@MikroTik", command);
    const real = "bad command name show (line 1 column 1)";
    const capturado = echo + real + "\r\n[admin@MikroTik] > ";

    const cut = recortarPorEco(capturado, command);

    expect(cut.recortado).toBe(true);
    expect(cut.reason).toBe("eco");

    expect(cut.text.startsWith(real)).toBe(true);
    expect(cut.text.split("admin@MikroTik").length - 1).toBeLessThanOrEqual(1);

    expect(capturado.length).toBeGreaterThan(cut.text.length * 4);
  });

  it("corta por el ÚLTIMO eco, que es el que tiene la salida detrás", () => {

    const capturado =
      "show version\r\nversion: 6.49.13\r\n" +
      "R1# show version\r\nVersion 6.49.13\r\nR1#";

    const cut = recortarPorEco(capturado, "show version");

    expect(cut.recortado).toBe(true);
    expect(cut.text).toContain("Version 6.49.13");
    expect(cut.text).not.toContain("version: 6.49.13");
  });

  it("el ancla tiene que estar acabada: un prefijo no cuenta como eco", () => {

    const capturado = "show running-config\r\nhostname R1\r\nend\r\nR1#";

    const cut = recortarPorEco(capturado, "show run");

    expect(cut.recortado).toBe(false);
    expect(cut.reason).toBe("sin_eco");
    expect(cut.text).toBe(capturado);
  });

  it("un eco partido en dos líneas (consola estrecha) también se reconoce", () => {
    const capturado = "R1# show\r\nversion\r\nCisco IOS 15.2(4)M7\r\nR1#";

    const cut = recortarPorEco(capturado, "show version");

    expect(cut.recortado).toBe(true);
    expect(cut.text).toContain("Cisco IOS 15.2(4)M7");
    expect(cut.text).not.toContain("show");
  });

  it("limpia el ANSI que el equipo mete DENTRO del ancla", () => {
    const capturado =
      "R1# \x1b[1mshow\x1b[m \x1b[1mversion\x1b[K\r\nCisco IOS 15.2\r\nR1#";

    const cut = recortarPorEco(capturado, "show version");

    expect(cut.recortado).toBe(true);
    expect(cut.text).toContain("Cisco IOS 15.2");
  });

  it("sin eco reconocible NO recorta: es preferible ruido a perder salida", () => {

    const capturado = "GigabitEthernet0/0     10.0.0.1    up    up\r\nR1#";

    const cut = recortarPorEco(capturado, "show ip interface brief");

    expect(cut.recortado).toBe(false);
    expect(cut.reason).toBe("sin_eco");
    expect(cut.text).toBe(capturado);
  });

  it("ancla al final sin nada detrás: no recorta y NUNCA devuelve vacío", () => {

    const capturado = "R1#show version\r\n";

    const cut = recortarPorEco(capturado, "show version");

    expect(cut.recortado).toBe(false);
    expect(cut.reason).toBe("eco_sin_salida");
    expect(cut.text).toBe(capturado);
    expect(cut.text).not.toBe("");
  });

  it("sin comando con texto no hay ancla posible", () => {
    const cut = recortarPorEco("cualquier cosa\r\n", "   ");

    expect(cut.recortado).toBe(false);
    expect(cut.reason).toBe("sin_comando");
  });
});

describe("clasificarEsperaDeEntrada: qué está pidiendo la consola", () => {
  it("reconoce el invariante de arranque del Cisco que pide un Return", () => {
    const arranque =
      "System Bootstrap, Version 15.2(4)M7\r\n\r\nPress RETURN to get started!";
    expect(clasificarEsperaDeEntrada(arranque)).toMatchObject({
      invariante: true,
      question: null,
      hasText: true,
    });
  });

  it("también `User Access Verification` y `System Bootstrap`", () => {
    expect(clasificarEsperaDeEntrada("\r\nUser Access Verification").invariante).toBe(
      true,
    );
    expect(clasificarEsperaDeEntrada("System Bootstrap").invariante).toBe(true);
  });

  it("una pregunta NUNCA es un invariante: ahí la respuesta es del usuario", () => {
    for (const text of [
      "Would you like to enter the initial configuration dialog? [yes/no]:",
      "Proceed with reload? [confirm]",
      "R1's password: ",
      "Username: ",
      "Login: ",
      "Are you sure you want to erase? (y/n) ",
    ]) {
      const status = clasificarEsperaDeEntrada(text);
      expect(status.question, `pregunta no detectada en: ${text}`).not.toBeNull();
    }
    expect(
      clasificarEsperaDeEntrada(
        "User Access Verification\r\nUsername: ",
      ).question,
    ).not.toBeNull();
  });

  it("sin un byte del equipo no hay indicio de nada (`hayTexto` false)", () => {
    expect(clasificarEsperaDeEntrada("")).toEqual({
      invariante: false,
      question: null,
      hasText: false,
    });
    expect(clasificarEsperaDeEntrada("\r\n  \x1b[m\x1b[K").hayTexto).toBe(false);
  });

  it("mira solo la cola: un `password:` de hace diez páginas no cuenta", () => {
    const historico = `user@R1's password: ${"x".repeat(600)}\r\nR1# `;

    expect(clasificarEsperaDeEntrada(historico).question).toBeNull();
  });
});

describe("Hub: la salida ya no vuelve contaminada por el eco", () => {
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

  
  function mockconsoleWithEchoRepintado(reply: string[]): void {
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          const command = text.replace(/\r$/, "");
          setTimeout(
            () =>
              hub.recordData(
                "s1",
                echoRouterOs("admin@MikroTik", command) + reply.join("\r\n"),
              ),
            5,
          );
        },
      }),
    );
    hub.recordData("s1", "\r\n[admin@MikroTik] > ");
  }

  it("sendCommandDetailed devuelve solo la salida y lo dice (recortado/motivoCorte)", async () => {
    mockconsoleWithEchoRepintado(["bad command name show (line 1 column 1)"]);

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show version", {
      idleMs: 60,
      maxMs: 2_000,
    });

    expect(result.output.trim()).toBe("bad command name show (line 1 column 1)");
    expect(result.recortado).toBe(true);
    expect(result.motivoCorte).toBe("eco");
  });

  it("el prompt que reemite el equipo no se devuelve al final de la salida", async () => {
    
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          setTimeout(
            () =>
              hub.recordData(
                "s1",
                `${text}\r\nCisco IOS Software, Version 15.2(4)M7\r\nR1 uptime is 38 minutes\r\n\r\nR1#`,
              ),
            5,
          );
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show version", {
      idleMs: 60,
      maxMs: 2_000,
    });

    expect(result.output).toContain("Cisco IOS Software, Version 15.2(4)M7");
    expect(result.output).not.toContain("show version");
    expect(result.output.trimEnd().endsWith("R1#")).toBe(false);
    expect(result.recortado).toBe(true);
  });

  it("un comando que no devuelve nada NO se queda sin salida (el prompt hace de prueba)", async () => {
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          setTimeout(() => hub.recordData("s1", "\r\nR1# "), 5);
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "clear counters", {
      idleMs: 60,
      maxMs: 1_000,
    });

    expect(result.output.trim()).not.toBe("");
    expect(result.executed).toEqual(["clear counters"]);
  });

  it("sin eco no se recorta y el paginador sigue paginando (no se rompe v4)", async () => {
    let page = 0;
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          if (text === " ") {
            page += 1;
            setTimeout(
              () => hub.recordData("s1", `\r\nlinea ${page + 1}\r\nR1# `),
              5,
            );
            return;
          }
          setTimeout(() => hub.recordData("s1", "\r\nlinea 1--More--"), 5);
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show run", {
      idleMs: 60,
      maxMs: 3_000,
    });


    expect(result.recortado).toBe(false);
    expect(result.motivoCorte).toBe("sin_eco");
    expect(result.paged).toBe(true);
    expect(result.pages).toBe(1);
    expect(result.output).toContain("linea 2");
  });
});

describe("Hub: despertar la consola que espera un Return", () => {
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

  
  const BANNER =
    "\r\n\r\nSystem Bootstrap, Version 15.2(4)M7\r\n\r\nPress RETURN to get started!";



  function mockconsoleTrasReturn(
    opciones: { ignoraRetorno?: boolean; reply?: string[] } = {},
  ): void {
    let prompted = false;
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          if (text === "\r") {

            if (!opciones.ignoraRetorno && !prompted) {
              prompted = true;
              setTimeout(() => hub.recordData("s1", "\r\nR1# "), 5);
            }
            return;
          }
          setTimeout(
            () =>
              hub.recordData(
                "s1",
                `${text}\r\n${(opciones.reply ?? ["Cisco IOS Software, Version 15.2(4)M7"]).join("\r\n")}\r\nR1#`,
              ),
            5,
          );
        },
      }),
    );
    hub.recordData("s1", BANNER);
  }

  it("el pre-flight despierta la consola y el comando sale con su salida", async () => {
    mockconsoleTrasReturn();

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show version", {
      idleMs: 100,
      maxMs: 3_000,
    });

    expect(result.executed).toEqual(["show version"]);
    expect(result.output).toContain("Cisco IOS Software, Version 15.2(4)M7");

    expect(writes[0]).toBe("\r");
    expect(writes[1]).toBe("show version\r");

    expect(result.despertar).toEqual({ intentos: 1, reasonFinal: null });
  });

  it("waitForPrompt también despierta (era el fallo que see en la batería real)", async () => {
    mockconsoleTrasReturn();
    const session = hub.get("s1")!;

    const snapshot = await hub.waitForPrompt(session, { timeoutMs: 3_000 });

    expect(snapshot.prompt).toBe("R1#");
    expect(snapshot.promptWaitMessage).toBeNull();
    expect(snapshot.despertar).toEqual({ intentos: 1, reasonFinal: null });
    expect(writes).toEqual(["\r"]);
  });

  it("los intentos están ACOTADOS: como máximo dos Returns", async () => {

    mockconsoleTrasReturn({ ignoraRetorno: true });

    const start = Date.now();
    await expect(
      hub.sendCommandDetailed(hub.get("s1")!, "show version", {
        idleMs: 100,
        maxMs: 4_000,
      }),
    ).rejects.toThrow(/no tiene un prompt listo/);

    const returns = writes.filter((t) => t === "\r").length;
    expect(returns).toBeGreaterThanOrEqual(1);
    expect(returns).toBeLessThanOrEqual(2);

    expect(Date.now() - start).toBeLessThan(4_500);
  });

  it("si aun así no hay prompt, el error lo dice claro", async () => {
    mockconsoleTrasReturn({ ignoraRetorno: true });

    let mensaje = "";
    try {
      await hub.sendCommandDetailed(hub.get("s1")!, "show version", {
        idleMs: 100,
        maxMs: 4_000,
      });
    } catch (error) {
      mensaje = error instanceof Error ? error.message : String(error);
    }

    expect(mensaje).toMatch(/Return\(s\)/);
    expect(mensaje).toMatch(/siguió sin aparecer/);
  });

  it("NUNCA despierta una consola que pide `[yes/no]`", async () => {
    hub.register(
      sessionRegistration({
        write: (data) => {
          writes.push(String(data));
          setTimeout(() => hub.recordData("s1", "\r\nR1# "), 5);
        },
      }),
    );
    hub.recordData(
      "s1",
      "\r\nSystem Bootstrap\r\nWould you like to enter the initial configuration dialog? [yes/no]:",
    );

    await expect(
      hub.sendCommandDetailed(hub.get("s1")!, "configure terminal", {
        idleMs: 60,
        maxMs: 2_000,
      }),
    ).rejects.toThrow(/no tiene un prompt listo/);

    expect(writes).toEqual([]);
  });

  it("NUNCA despierta una consola que pide el login", async () => {
    for (const pending of ["Username: ", "R1's password: ", "\r\nProceed? [confirm]"]) {
      writes = [];
      hub.clear();
      hub.register(
        sessionRegistration({
          write: (data) => {
            writes.push(String(data));
            setTimeout(() => hub.recordData("s1", "\r\nR1# "), 5);
          },
        }),
      );
      hub.recordData("s1", pending);

      await expect(
        hub.sendCommandDetailed(hub.get("s1")!, "show version", {
          idleMs: 60,
          maxMs: 600,
        }),
      ).rejects.toThrow(/no tiene un prompt listo/);
      expect(writes, `se escribió algo ante "${pending}"`).toEqual([]);
    }
  });

  it("una consola muda (sin un byte del equipo) no se despierta", async () => {

    hub.register(
      sessionRegistration({
        write: (data) => {
          writes.push(String(data));
        },
      }),
    );

    await expect(
      hub.sendCommandDetailed(hub.get("s1")!, "show version", {
        idleMs: 60,
        maxMs: 2_000,
      }),
    ).rejects.toThrow(/no tiene un prompt listo/);
    expect(writes).toEqual([]);
  });

  it("no le mete un Return encima de lo que está tecleando el usuario", async () => {
    mockconsoleTrasReturn();
    hub.noteUserInput("s1");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show version", {
      idleMs: 100,
      maxMs: 3_000,
    });


    expect(writes[0]).toBe("show version\r");
    expect(writes).toHaveLength(1);
    expect(result.executed).toEqual(["show version"]);
  });

  it("con el prompt ya en consola no se manda ningún Return de despertar", async () => {
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          setTimeout(() => hub.recordData("s1", `${text}\r\nVersion 15.2\r\nR1# `), 5);
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show version", {
      idleMs: 60,
      maxMs: 1_000,
    });

    expect(writes).toEqual(["show version\r"]);
    expect(result.despertar).toBeNull();
    expect(result.preflightWaitMs).toBeLessThanOrEqual(50);
  });
});
