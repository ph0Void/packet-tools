

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectarPaginador,
  limpiarMarcasPaginador,
  PAGINADOR_KEY,
  PAGINADOR_MAX_PAGINAS,
  snapshotPromptSatisfies,
  TerminalSessionHub,
  terminalSessionHub,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";
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
  description: string;
  invoke: (input: Record<string, unknown>) => Promise<string>;
}


function toolByName(name: string): InvokableTool {
  const encontrada = TERMINAL_TOOLS.find((candidate) => candidate.name === name);
  if (!encontrada) throw new Error(`Tool no encontrada: ${name}`);
  return encontrada as unknown as InvokableTool;
}

describe("detectarPaginador: variantes de cada fabricante", () => {
  it("reconoce la marca de Cisco sin distinguir mayúsculas", () => {
    expect(
      detectarPaginador("hostname R1\r\nlinea 23\r\n --More--").variant,
    ).toBe("mas-more");
    expect(detectarPaginador("--MORE--").activo).toBe(true);
    expect(detectarPaginador("--more--").activo).toBe(true);
    expect(detectarPaginador("-- more --").activo).toBe(true);
  });

  it("reconoce los guiones de una línea (Huawei VRP y similares)", () => {

    const huawei = detectarPaginador(
      " interface GigabitEthernet0/0/1\r\n ---- More ----",
    );
    expect(huawei).toMatchObject({ active: true, variant: "mas-more" });


    const simple = detectarPaginador("description algo -More-");
    expect(simple).toMatchObject({ active: true, variant: "guion-more" });
  });

  it("reconoce el [Q|quit] de Aruba y el (END) de salida larga", () => {
    expect(
      detectarPaginador("Building configuration...\r\n [Q|quit]"),
    ).toMatchObject({ active: true, variant: "q-quit" });
    expect(detectarPaginador("show tech-support completo (END)")).toMatchObject({
      active: true,
      variant: "end",
    });
  });

  it("reconoce la forma en inglés y la en chino", () => {
    expect(
      detectarPaginador(
        "some data\r\n-- Press space to continue, press q to stop --",
      ).activo,
    ).toBe(true);
    expect(detectarPaginador("配置行\r\n按Enter继续").activo).toBe(true);
    expect(detectarPaginador("按空格继续").activo).toBe(true);
  });

  it("devuelve la marca exacta y se la lleva los ANSI por delante", () => {
    const deteccion = detectarPaginador("linea 23\r\n\x1b[2K --More--\x1b[1A");
    expect(deteccion.activo).toBe(true);
    expect(deteccion.marker).toMatch(/more/i);
    expect(deteccion.variant).toBe("mas-more");
  });

  it("mira solo la cola: una marca vieja y ya pagada no es un paginador vivo", () => {

    const historico = `--More--\n${"linea de configuración\n".repeat(60)}R1# `;
    expect(detectarPaginador(historico).activo).toBe(false);
  });
});

describe("detectarPaginador: falsos positivos que NO deben pagarse", () => {
  const fake = [
    "There are 3 more interfaces in this configuration",
    "more",
    "show ip interface brief | include more",
    "  23 more lines of output",
    "Are you sure you want to continue? [confirm]",
    "Delete flash:/? [confirm]",
    "Proceed with reload? [yes/no]:",
    "Press RETURN to get started.",
    "user@R1's password:",
    "R1# ",
    "",
    "   ",
  ];

  for (const text of fake) {
    it(`no detecta paginador en ${JSON.stringify(text.slice(0, 40))}`, () => {
      expect(detectarPaginador(text)).toEqual({
        active: false,
        variant: null,
        marker: null,
      });
    });
  }
});

describe("limpiarMarcasPaginador", () => {
  it("quita las marcas de paginador del texto capturado", () => {
    expect(limpiarMarcasPaginador("linea 23 --More--linea 24")).toBe(
      "linea 23 linea 24",
    );
    expect(limpiarMarcasPaginador("a ---- More ----b")).toBe("a b");
    expect(limpiarMarcasPaginador("x [Q|quit]y")).toBe("x y");
  });

  it("no toca texto normal que hable de \"more\"", () => {
    expect(limpiarMarcasPaginador("there are 3 more interfaces")).toBe(
      "there are 3 more interfaces",
    );
  });
});

describe("Hub: el agente paga el paginador y recibe la salida completa", () => {
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

  
  function espaciosPagados(): number {
    return writes.filter((t) => t === PAGINADOR_KEY).length;
  }



  function mockconsoleThatPage(pages: string[], marker = "--More--") {
    let page = 0;
    const emit = (index: number) => {

      const hasMas = index + 1 < pages.length;
      const text = hasMas
        ? `${pages[index]}${marker}`
        : `${pages[index]}\r\nR1# `;
      setTimeout(() => hub.recordData("s1", `\r\n${text}`), 5);
    };
    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);

          if (text === PAGINADOR_KEY) {
            page += 1;
            emit(page);
            return;
          }
          emit(0);
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");
    return hub.get("s1")!;
  }

  it("paga cada página con un espacio y devuelve la salida entera", async () => {
    const session = mockconsoleThatPage(["linea 1", "linea 2", "linea 3"]);

    const result = await hub.sendCommandDetailed(session, "show run", {
      idleMs: 60,
      maxMs: 3_000,
    });

    expect(result.executed).toEqual(["show run"]);
    expect(result.paged).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.pagerVariant).toBe("mas-more");
    expect(result.endReason).toBe("idle");
    expect(result.output).toContain("linea 1");
    expect(result.output).toContain("linea 2");
    expect(result.output).toContain("linea 3");

    expect(result.output).not.toContain("--More--");

    expect(espaciosPagados()).toBe(2);
    expect(writes[0]).toBe("show run\r");
  });

  it("también paga el paginador de otro fabricante (---- More ---- de Huawei)", async () => {
    const session = mockconsoleThatPage(["linea 1", "linea 2"], " ---- More ----");

    const result = await hub.sendCommandDetailed(
      session,
      "display current-configuration",
      { idleMs: 60, maxMs: 3_000 },
    );

    expect(result.paged).toBe(true);
    expect(result.pages).toBe(1);
    expect(result.pagerVariant).toBe("mas-more");
    expect(result.output).toContain("linea 2");
    expect(result.endReason).toBe("idle");
  });

  it("sin paginador el resultado dice que no hubo paginación", async () => {
    hub.register(
      sessionRegistration({
        write: () => {
          setTimeout(() => hub.recordData("s1", "\r\nVersion 15.2\r\nR1# "), 5);
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show version", {
      idleMs: 40,
      maxMs: 1_000,
    });

    expect(result.paged).toBe(false);
    expect(result.pages).toBe(0);
    expect(result.pagerVariant).toBeNull();
    expect(espaciosPagados()).toBe(0);
  });

  it("lote vacío: los campos de paginación están siempre presentes", async () => {
    hub.register(sessionRegistration({ write: () => {} }));
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.runCommandsDetailed(hub.get("s1")!, ["   "], {
      idleMs: 40,
      maxMs: 300,
    });

    expect(result.paged).toBe(false);
    expect(result.pages).toBe(0);
    expect(result.pagerVariant).toBeNull();
  });
});

describe("Hub: topes del pago del paginador", () => {
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

  
  function espaciosPagados(): number {
    return writes.filter((t) => t === PAGINADOR_KEY).length;
  }

  it("un paginador COLGADO no se convierte en bucle de teclas", async () => {

    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          if (text === PAGINADOR_KEY) return;
          setTimeout(() => hub.recordData("s1", "\r\nlinea 1\r\n --More--"), 5);
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const start = Date.now();
    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show run", {
      idleMs: 60,
      maxMs: 5_000,
    });


    expect(result.endReason).toBe("pending");
    expect(result.timedOut).toBe(false);
    expect(result.paged).toBe(true);
    expect(result.pages).toBe(1);
    expect(espaciosPagados()).toBe(1);
    expect(result.pendingInput).toMatch(/more/i);
    expect(Date.now() - start).toBeLessThan(4_000);
  });

  it("el eco del espacio tampoco cuenta como avance (paginador muerto)", async () => {

    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          setTimeout(
            () =>
              hub.recordData(
                "s1",
                text === PAGINADOR_KEY
                  ? " "
                  : "\r\nlinea 1\r\n --More--",
              ),
            5,
          );
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show run", {
      idleMs: 60,
      maxMs: 5_000,
    });

    expect(result.endReason).toBe("pending");

    expect(result.pages).toBe(1);
    expect(espaciosPagados()).toBe(1);
  });

  it("un paginador infinito se corta por el tope de páginas", async () => {
    let n = 0;

    hub.register(
      sessionRegistration({
        write: (data) => {
          const text = String(data);
          writes.push(text);
          if (text !== PAGINADOR_KEY) {
            setTimeout(() => hub.recordData("s1", "\r\npagina 1\r\n --More--"), 5);
            return;
          }
          n += 1;
          setTimeout(
            () => hub.recordData("s1", `\r\npagina ${n + 1}\r\n --More--`),
            5,
          );
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "show run", {
      idleMs: 60,
      maxMs: 60_000,
    });

    expect(result.endReason).toBe("pending");
    expect(result.pages).toBe(PAGINADOR_MAX_PAGINAS);
    expect(espaciosPagados()).toBe(PAGINADOR_MAX_PAGINAS);
  });

  it("respeta el plazo global: pagar páginas no alarga el turno", async () => {

    hub.register(
      sessionRegistration({
        write: () => {
          const tic = setInterval(
            () => hub.recordData("s1", "\r\nlinea de salida"),
            20,
          );
          setTimeout(() => clearInterval(tic), 10_000).unref?.();
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const start = Date.now();
    const result = await hub.sendCommandDetailed(
      hub.get("s1")!,
      "show tech-support",
      { idleMs: 200, maxMs: 400 },
    );

    expect(result.endReason).toBe("maxMs");
    expect(result.timedOut).toBe(true);
    expect(result.pages).toBe(0);
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it("no paga una confirmación: la respuesta la pone el usuario", async () => {
    hub.register(
      sessionRegistration({
        write: () => {
          setTimeout(
            () => hub.recordData("s1", "\r\nReload the system? [confirm]"),
            5,
          );
        },
      }),
    );
    hub.recordData("s1", "\r\nR1# ");

    const result = await hub.sendCommandDetailed(hub.get("s1")!, "reload", {
      idleMs: 60,
      maxMs: 1_000,
    });

    expect(espaciosPagados()).toBe(0);
    expect(result.paged).toBe(false);
    expect(result.pages).toBe(0);
    expect(result.output).toContain("[confirm]");
  });

  it("no paga una pregunta [yes/no] ni un Press RETURN", async () => {
    for (const wait of ["Continue? [yes/no]:", "Press RETURN to get started."]) {
      hub.clear();
      writes = [];
      hub.register(
        sessionRegistration({
          write: () => {
            setTimeout(() => hub.recordData("s1", `\r\n${wait}`), 5);
          },
        }),
      );
      hub.recordData("s1", "\r\nR1# ");

      const result = await hub.sendCommandDetailed(hub.get("s1")!, "show run", {
        idleMs: 60,
        maxMs: 800,
      });

      expect(espaciosPagados()).toBe(0);
      expect(result.pages).toBe(0);
    }
  });
});

describe("snapshotPromptSatisfies: el criterio que usa wait_for_prompt", () => {
  it("pide token completo, no subcadena (R1 no es core-r1)", () => {
    expect(
      snapshotPromptSatisfies({ prompt: "core-r1#", vendor: "cisco" }, "R1"),
    ).toBe(false);
    expect(snapshotPromptSatisfies({ prompt: "R1#", vendor: "cisco" }, "R1")).toBe(
      true,
    );
    expect(
      snapshotPromptSatisfies({ prompt: "R1(config)#", vendor: "cisco" }, "R1"),
    ).toBe(true);
  });

  it("un expected con forma de prompt tiene que ser el prompt entero", () => {
    expect(
      snapshotPromptSatisfies({ prompt: "R1#", vendor: "cisco" }, "R1(config)#"),
    ).toBe(false);
    expect(
      snapshotPromptSatisfies({ prompt: "[R1]", vendor: "huawei" }, "[R1]"),
    ).toBe(true);
    expect(
      snapshotPromptSatisfies(
        { prompt: "[R1-GigabitEthernet0/0]", vendor: "huawei" },
        "[R1]",
      ),
    ).toBe(false);
  });

  it("sin expected basta con que haya prompt; sin prompt nunca", () => {
    expect(snapshotPromptSatisfies({ prompt: "core-r1#", vendor: "cisco" })).toBe(
      true,
    );
    expect(snapshotPromptSatisfies({ prompt: null, vendor: "cisco" })).toBe(false);
    expect(
      snapshotPromptSatisfies({ prompt: "", vendor: "conservative" }),
    ).toBe(false);
  });
});

describe("TerminalTools: paginación y matching de prompt en el payload", () => {
  afterEach(() => {
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  it("send_command expone paged/pages/pagerVariant cuando el equipo pagina", async () => {
    const writes: string[] = [];
    let page = 0;
    terminalSessionHub.register(
      sessionRegistration({
        socketId: "s1",
        write: (data) => {
          const text = String(data);
          writes.push(text);
          if (text === PAGINADOR_KEY) {

            page += 1;
            setTimeout(() => {
              terminalSessionHub.recordData(
                "s1",
                `\r\nlinea ${page + 1}\r\nR1# `,
              );
            }, 5);
            return;
          }
          setTimeout(
            () => terminalSessionHub.recordData("s1", "\r\nlinea 1\r\n--More--"),
            5,
          );
        },
      }),
    );
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("send_command").invoke({
          command: "show run",
          timeoutMs: 3_000,
        }),
      ),
    );

    expect(output.success).toBe(true);
    expect(output.paged).toBe(true);
    expect(output.pages).toBe(1);
    expect(output.pagerVariant).toBe("mas-more");
    expect(output.output).toContain("linea 1");
    expect(output.output).toContain("linea 2");
    expect(output.output).not.toContain("--More--");
    expect(String(output.warning)).toMatch(/pagin/);
  });

  it("wait_for_prompt no da por buena una consola que está en core-r1", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData("s1", "\r\ncore-r1# ");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("wait_for_prompt").invoke({ expected: "R1", timeoutMs: 300 }),
      ),
    );

    expect(output.timedOut).toBe(true);
    expect(output.prompt).toBe("core-r1#");
    expect(String(output.promptWaitMessage)).toMatch(/se esperaba "R1"/);
  });

  it("wait_for_prompt acepta el prompt pedido de verdad", async () => {
    terminalSessionHub.register(sessionRegistration({ socketId: "s1" }));
    terminalSessionHub.recordData("s1", "\r\nR1# ");

    const output = JSON.parse(
      await requestContext.run(userContext(), () =>
        toolByName("wait_for_prompt").invoke({ expected: "R1", timeoutMs: 300 }),
      ),
    );

    expect(output.timedOut).toBe(false);
    expect(output.promptWaitMessage).toBeNull();
  });

  it("las descripciones en inglés cuentan lo del paginador y el matching", () => {
    expect(toolByName("send_command").description).toMatch(/pagin/i);
    expect(toolByName("wait_for_prompt").description).toMatch(/substring/i);
  });
});
