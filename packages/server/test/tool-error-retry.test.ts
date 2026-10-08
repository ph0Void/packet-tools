

import { describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import {
  clasificarErrorDeTool,
  clasificarToolMessage,
  REGLA_DE_REINTENTOS,
  resultadoEsFallo,
} from "@/agent/security/ToolErrorClassifier";
import {
  huellaDeTool,
  PREFIJO_REINTENTO_BLOQUEADO,
  resultadosPorHuella,
  retryGuardMiddleware,
} from "@/agent/deep/retryGuardMiddleware";
import { buildAgentMiddleware } from "@/agent/AgentRuntime";
import { BASE_SUPERVISOR_PROMPT } from "@/agent/deep/DeepSupervisor";
import { SSH_PROMPT } from "@/agent/ssh/Promt";
import { TELNET_PROMPT } from "@/agent/telnet/Promt";
import { SERIAL_PORT_PROMPT } from "@/agent/serialPort/Promt";
import { CISCO_PACKET_TRACER_PROMPT } from "@/agent/ciscoPacketTracer/Promt";


const CLI_INVALIDO =
  "% Invalid input detected at '^' marker. R1(config)#";

describe("clasificacion de retryabilidad", () => {
  it("transitorio: red, 5xx, cuota y sesion ocupada", () => {
    const transitorios = [
      "Error ejecutando comandos: read ETIMEDOUT",
      "socket hang up al escribir en la consola",
      '{"success":false,"error":"El servidor devolvio 503"}',
      "rate limit exceeded, try again later",
      "la sesion esta ocupada: busy",
      "Error: la operacion agoto su tiempo (timeout 25000ms)",
    ];
    for (const text of transitorios) {
      const verdict = clasificarErrorDeTool({ text, status: "error" });
      expect(verdict.clase, `esperaba transitorio: ${text}`).toBe("transient");
      expect(verdict.reintentable).toBe(true);
      expect(verdict.etiqueta).toBe("[ERROR TRANSITORIO]");
    }
  });

  it("definitivo: entrada invalida, comando desconocido y argumentos mal formados", () => {
    const definitivos = [
      CLI_INVALIDO,
      "% Ambiguous command:  sh",
      "% Incomplete command.",
      "ZodError: argument validation failed",
      '{"success":false,"error":"% Unrecognized command"}',
    ];
    for (const text of definitivos) {
      const verdict = clasificarErrorDeTool({ text });
      expect(verdict.clase, `esperaba definitivo: ${text}`).toBe("definitive");
      expect(verdict.reintentable).toBe(false);
      expect(verdict.etiqueta).toBe("[ERROR DEFINITIVO]");
    }
  });

  it("definitivo: dispositivo inexistente o apagado (no improves repitiendo)", () => {
    for (const text of [
      "Error conectando: connect ECONNREFUSED 10.0.0.1:23",
      "getaddrinfo ENOTFOUND router.interno",
      "el dispositivo R9 no existe en Packet Tracer",
    ]) {
      expect(clasificarErrorDeTool({ text, status: "error" }).clase).toBe(
        "definitive",
      );
    }
  });

  it("definitivo: aprobacion rechazada, expirada, rol bloqueado y consola cerrada", () => {
    const blocks = [
      "[APROBACION_RECHAZADA] El usuario rechazó la ejecución de «Borrar equipo».",
      "[APROBACION_EXPIRADA] La solicitud de aprobación expiró sin respuesta.",
      "[BLOQUEADO_ROL] Tu rol (USER) no puede ejecutar acciones de configuración.",
      "[SESION_PROTEGIDA] Los comandos de cierre de sesión están bloqueados.",
      '{"success":false,"code":"TERMINAL_REQUIRED","message":"no tiene una consola abierta"}',
    ];
    for (const text of blocks) {
      const verdict = clasificarErrorDeTool({ text, status: "error" });
      expect(verdict.clase, `esperaba definitivo: ${text}`).toBe("definitive");
    }
  });

  it("lo que no encaja se queda en desconocido y NO bloquea nada", () => {
    const verdict = clasificarErrorDeTool({ text: "algo raro sin pistas" });
    expect(verdict.clase).toBe("unknown");
    expect(verdict.reintentable).toBe(true);
    expect(clasificarErrorDeTool({}).clase).toBe("unknown");
  });

  it("ante conflicto gana el definitivo (bloquear cuesta una ronda, dejar pasar cuesta el turno)", () => {
    const verdict = clasificarErrorDeTool({
      text: "% Invalid input detected (timeout de lectura)",
    });
    expect(verdict.clase).toBe("definitive");
  });

  it("detecta el fallo aunque venga dentro de un 200 de Packet Tracer", () => {
    const text = '{"success":false,"error":"% Invalid input detected"}';
    expect(resultadoEsFallo({ text, status: "success" })).toBe(true);
    expect(clasificarToolMessage({ content: text, status: "success" }).clase).toBe(
      "definitive",
    );
    expect(
      resultadoEsFallo({ text: '{"success":true,"devices":[]}', status: "success" }),
    ).toBe(false);
  });

  it("la instruccion de reintentos esta en el supervisor y en los tres especialistas", () => {
    expect(REGLA_DE_REINTENTOS).toContain("[ERROR DEFINITIVO]");
    expect(REGLA_DE_REINTENTOS).toContain("[ERROR TRANSITORIO]");
    expect(REGLA_DE_REINTENTOS).toContain("identical call returns the identical error");
    for (const prompt of [
      BASE_SUPERVISOR_PROMPT,
      SSH_PROMPT,
      TELNET_PROMPT,
      SERIAL_PORT_PROMPT,
      CISCO_PACKET_TRACER_PROMPT,
    ]) {
      expect(prompt).toContain(REGLA_DE_REINTENTOS);

      expect(prompt).not.toContain("do not retry it more than once");
      expect(prompt).not.toContain("do NOT retry it more than once");
    }
  });
});


function historyWith(
  name: string,
  args: Record<string, unknown>,
  content: string,
  status?: "error",
): unknown[] {
  return [
    new AIMessage({
      content: "",
      tool_calls: [{ name: name, args, id: "t1", type: "tool_call" as const }],
    }),
    new ToolMessage({ content: content, tool_call_id: "t1", name: name, status }),
  ];
}

describe("middleware de reintentos identicos", () => {
  
  function wrapOf(middleware: ReturnType<typeof retryGuardMiddleware>) {
    return middleware.wrapToolCall as unknown as (
      request: unknown,
      handler: (request: unknown) => Promise<ToolMessage>,
    ) => Promise<ToolMessage>;
  }

  function prompt(
    threadId: string,
    name: string,
    args: Record<string, unknown>,
    messages: unknown[],
  ) {
    return {
      toolCall: { name: name, args, id: "t2", type: "tool_call" },
      tool: undefined,
      state: { messages: messages },
      runtime: { configurable: { thread_id: threadId } },
    };
  }

  it("bloquea el reintento identico tras un fallo definitivo", async () => {
    const middleware = retryGuardMiddleware();
    const wrap = wrapOf(middleware);
    const run = vi.fn(async () =>
      new ToolMessage({ content: "no se ejecutó", tool_call_id: "t2" }),
    );
    const history = historyWith(
      "send_command",
      { command: "sh" },
      CLI_INVALIDO,
      "error",
    );

    const output = await wrap(
      prompt("hilo", "send_command", { command: "sh" }, history),
      run,
    );
    expect(run).not.toHaveBeenCalled();
    expect(String(output.content)).toContain(PREFIJO_REINTENTO_BLOQUEADO);
    expect(String(output.content)).toContain("[ERROR DEFINITIVO]");
    expect(output.status).toBe("error");
  });

  it("deja reintentar si el fallo fue transitorio", async () => {
    const middleware = retryGuardMiddleware();
    const wrap = wrapOf(middleware);
    const run = vi.fn(async () =>
      new ToolMessage({ content: "ok", tool_call_id: "t2" }),
    );
    const history = historyWith(
      "send_command",
      { command: "sh" },
      "Error: read ETIMEDOUT",
      "error",
    );
    const output = await wrap(
      prompt("hilo", "send_command", { command: "sh" }, history),
      run,
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(output.status).toBeUndefined();
  });

  it("deja reintentar si cambian los argumentos", async () => {
    const middleware = retryGuardMiddleware();
    const wrap = wrapOf(middleware);
    const run = vi.fn(async () =>
      new ToolMessage({ content: "ok", tool_call_id: "t2" }),
    );
    const history = historyWith(
      "send_command",
      { command: "sh" },
      CLI_INVALIDO,
      "error",
    );
    await wrap(
      prompt("hilo", "send_command", { command: "show" }, history),
      run,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("el fingerprint no depende del orden de las claves", () => {
    expect(huellaDeTool("a", { x: 1, y: 2 })).toBe(huellaDeTool("a", { y: 2, x: 1 }));
    expect(huellaDeTool("a", { x: 1 })).not.toBe(huellaDeTool("a", { x: 2 }));
  });

  it("solo mira el resultado MAS RECIENTE de cada huella", () => {
    const history = [
      ...historyWith("send_command", { command: "sh" }, CLI_INVALIDO, "error"),
      ...historyWith("send_command", { command: "sh" }, "show version", "success").map(
        (mensaje, index) =>
          index === 0
            ? new AIMessage({
                content: "",
                tool_calls: [
                  { name: "send_command", args: { command: "sh" }, id: "t9", type: "tool_call" as const },
                ],
              })
            : new ToolMessage({ content: "show version", tool_call_id: "t9", name: "send_command" }),
      ),
    ];
    const previos = resultadosPorHuella(history as never);
    const key = huellaDeTool("send_command", { command: "sh" });
    expect(previos.get(key)?.veredicto.clase).not.toBe("definitive");
  });

  it("sin historial ejecuta siempre", async () => {
    const middleware = retryGuardMiddleware();
    const wrap = wrapOf(middleware);
    const run = vi.fn(async () =>
      new ToolMessage({ content: "ok", tool_call_id: "t2" }),
    );
    await wrap(prompt("hilo", "send_command", { command: "sh" }, []), run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("el middleware va montado en el stack estandar de todos los agentes", () => {
    expect(buildAgentMiddleware({}).map((m) => m.name)).toContain("RetryGuard");
    expect(
      buildAgentMiddleware({ retryGuard: false }).map((m) => m.name),
    ).not.toContain("RetryGuard");

    const names = buildAgentMiddleware({}).map((m) => m.name);
    expect(names.indexOf("ApprovalMiddleware")).toBeLessThan(
      names.indexOf("RetryGuard"),
    );
  });

  it("no toca los agentes sin HITL cuando se pide así", () => {
    const names = buildAgentMiddleware({
      withApproval: false,
      retryGuard: false,
    }).map((m) => m.name);
    expect(names).not.toContain("ApprovalMiddleware");
    expect(names).not.toContain("RetryGuard");
  });

  it("un HumanMessage suelto en el historial no rompe el calculo", () => {
    const previos = resultadosPorHuella([new HumanMessage("hola")] as never);
    expect(previos.size).toBe(0);
  });
});
