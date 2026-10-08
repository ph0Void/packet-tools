

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import {
  MARCADORES_FIN_DE_TURNO,
  cerrarSegmentosPendientes,
  clasificarEstadoToolResult,
  detectarMarcadorFinDeTurno,
  type MotivoBarridoTurno,
  type SegmentoStream,
  type ToolExecution,
} from "@/api/router/ChatsRouter";
import {
  APPROVAL_MESSAGE_PREFIXES,
  approvalMiddleware,
  resetApprovalAttempts,
} from "@/agent/approval/ApprovalMiddleware";
import { approvalBroker } from "@/agent/approval/ApprovalBroker";
import { requestContext, type RequestUser } from "@/utils/RequestContext";

type Handler = (request: unknown) => Promise<ToolMessage>;

interface EventSse {
  event: string;
  data: any;
}


const STATUSES_TOOL = [
  "running",
  "waiting_approval",
  "completed",
  "rejected",
  "error",
] as const;

const RAIZ = join(__dirname, "..");



describe("barrido de cierre: marcador de fin de turno", () => {
  it("cierra una tool en vuelo como error con [TURNO_INTERRUMPIDO]", () => {
    const segments: SegmentoStream[] = [
      { kind: "text", text: "voy a leer el router" },
      {
        kind: "tool",
        id: "tc-1",
        name: "send_command",
        input: { command: "show version" },
        status: "running",
      },
    ];
    const events: EventSse[] = [];
    const ejecuciones: ToolExecution[] = [];

    cerrarSegmentosPendientes(
      segments,
      (event, data) => events.push({ event, data }),
      ejecuciones,
    );

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("tool_call_result");
    expect(events[0].data.status).toBe("error");
    expect(events[0].data.output.startsWith(MARCADORES_FIN_DE_TURNO.finTurno)).toBe(true);
    
    expect(ejecuciones[0].status).toBe("error");
    const segment = segments[1];
    expect(segment.kind === "tool" && segment.status).toBe("error");
  });

  it("la delegación (task) NO se marca como interrumpida si el turno terminó bien (V6)", () => {
    
    
    
    
    const segments: SegmentoStream[] = [
      { kind: "tool", id: "tc-task", name: "task", input: { description: "lee el modelo" }, status: "running" },
      { kind: "tool", id: "tc-send", name: "send_command", input: {}, status: "completed", output: "Cisco 2691" },
    ];
    const events: EventSse[] = [];
    const ejecuciones: ToolExecution[] = [];

    cerrarSegmentosPendientes(segments, (event, data) => events.push({ event, data }), ejecuciones);

    const delegation = events.find((e) => e.data.id === "tc-task");
    expect(delegation?.data.status).toBe("completed");
    expect(String(delegation?.data.output)).not.toContain(MARCADORES_FIN_DE_TURNO.finTurno);
    expect(ejecuciones.find((e) => e.id === "tc-task")?.status).toBe("completed");
  });

  it("la delegación sí se marca interrumpida si el turno se canceló o falló", () => {
    for (const reason of ["cancelacion", "error"] as MotivoBarridoTurno[]) {
      const segments: SegmentoStream[] = [
        { kind: "tool", id: `tc-task-${reason}`, name: "task", input: {}, status: "running" },
      ];
      const ejecuciones: ToolExecution[] = [];
      cerrarSegmentosPendientes(segments, () => {}, ejecuciones, reason);
      expect(ejecuciones[0].status, reason).not.toBe("completed");
      expect(ejecuciones[0].output.startsWith(MARCADORES_FIN_DE_TURNO[reason]), reason).toBe(true);
    }
  });

  it("una tool normal en vuelo sigue marcándose como interrumpida con el turno cerrado bien", () => {

    const segments: SegmentoStream[] = [
      { kind: "tool", id: "tc-send", name: "send_command", input: {}, status: "running" },
    ];
    const ejecuciones: ToolExecution[] = [];
    cerrarSegmentosPendientes(segments, () => {}, ejecuciones, "fin_turno");
    expect(ejecuciones[0].status).toBe("error");
    expect(ejecuciones[0].output.startsWith(MARCADORES_FIN_DE_TURNO.finTurno)).toBe(true);
  });

  it("los tres motivos de corte emiten su marcador y ninguno queda completed", () => {
    const esperado: Record<MotivoBarridoTurno, string> = {
      end_turn: MARCADORES_FIN_DE_TURNO.finTurno,
      cancellation: MARCADORES_FIN_DE_TURNO.cancelacion,
      error: MARCADORES_FIN_DE_TURNO.error,
    };

    for (const reason of Object.keys(esperado) as MotivoBarridoTurno[]) {
      const segments: SegmentoStream[] = [
        { kind: "tool", id: `tc-${reason}`, name: "send_command", input: {}, status: "running" },
      ];
      const ejecuciones: ToolExecution[] = [];

      cerrarSegmentosPendientes(segments, () => {}, ejecuciones, reason);

      expect(ejecuciones[0].output.startsWith(esperado[reason]), reason).toBe(true);
      expect(ejecuciones[0].status, reason).not.toBe("completed");

      expect(clasificarEstadoToolResult(ejecuciones[0].output), reason).toBe(ejecuciones[0].status);
    }
  });

  it("una tool que esperaba aprobación se cierra como rejected con [APROBACION_CANCELADA]", () => {
    const segments: SegmentoStream[] = [
      { kind: "tool", id: "tc-ap", name: "configure_device", input: {}, status: "waiting_approval" },
    ];
    const ejecuciones: ToolExecution[] = [];

    cerrarSegmentosPendientes(segments, () => {}, ejecuciones);

    expect(ejecuciones[0].output.startsWith(MARCADORES_FIN_DE_TURNO.aprobacionCancelada)).toBe(true);
    expect(ejecuciones[0].status).toBe("rejected");
    expect(clasificarEstadoToolResult(ejecuciones[0].output)).toBe("rejected");
  });
});



describe("clasificarEstadoToolResult: los marcadores nunca son completed", () => {
  it("un ToolMessage cuyo texto trae [TURNO_INTERRUMPIDO] NO es completed", () => {

    const messageDelegado = new ToolMessage({
      content: `Sub-agente configure_device: ${MARCADORES_FIN_DE_TURNO.finTurno} La herramienta no reportó resultado antes de finalizar el turno.`,
      tool_call_id: "tc-task-1",
      name: "task",
    });

    const status = clasificarEstadoToolResult(
      String(messageDelegado.content ?? ""),
      (messageDelegado as { status?: string }).status,
    );

    expect(status).toBe("error");
    expect(status).not.toBe("completed");
  });

  it("da igual que el ToolMessage traiga status, no lo traiga o traiga error", () => {
    const output = `Resultado parcial.\n\n${MARCADORES_FIN_DE_TURNO.finTurno} La herramienta no reportó resultado antes de finalizar el turno.`;
    for (const status of [undefined, "success", "error"] as Array<string | undefined>) {
      expect(clasificarEstadoToolResult(output, status), String(status)).toBe("error");
    }
  });

  it("cubre los cuatro marcadores con el estado que les corresponde", () => {
    const esperado: Array<[string, string]> = [
      [MARCADORES_FIN_DE_TURNO.finTurno, "error"],
      [MARCADORES_FIN_DE_TURNO.cancelacion, "error"],
      [MARCADORES_FIN_DE_TURNO.error, "error"],
      [MARCADORES_FIN_DE_TURNO.aprobacionCancelada, "rejected"],
    ];
    for (const [marker, status] of esperado) {

      for (const output of [
        marker,
        `Salida de la tool.\n\n${marker}`,
        `Antes.\n${marker}\nDespués.`,
      ]) {
        expect(clasificarEstadoToolResult(output), output).toBe(status);
        expect(clasificarEstadoToolResult(output)).not.toBe("completed");
      }
      expect(detectarMarcadorFinDeTurno(marker), marker).toBe(marker);
    }
  });

  it("no inventa marcadores: una salida normal sigue siendo completed/error", () => {
    expect(detectarMarcadorFinDeTurno("show version\nCisco IOS 15.2")).toBeNull();
    expect(clasificarEstadoToolResult("show version\nCisco IOS 15.2")).toBe("completed");
    expect(clasificarEstadoToolResult("falló la conexión SSH")).toBe("completed");
    expect(clasificarEstadoToolResult("falló la conexión SSH", "error")).toBe("error");
    expect(clasificarEstadoToolResult("")).toBe("completed");
    expect(clasificarEstadoToolResult("", "error")).toBe("error");
  });

  it("conserva la precedencia de los prefijos de aprobación (rejected)", () => {
    for (const prefix of Object.values(APPROVAL_MESSAGE_PREFIXES)) {
      expect(clasificarEstadoToolResult(`${prefix} Motivo`), prefix).toBe("rejected");
    }
  });

  it("todos los estados que emite el backend están en la whitelist del frontend", () => {

    const route = join(RAIZ, "..", "web", "src", "hooks", "useCiscoChat.ts");
    expect(existsSync(route), `no se encuentra ${route}`).toBe(true);
    const fuente = readFileSync(route, "utf8");
    const list = /VALID_TOOL_STATUS[^=]*=\s*\[([^\]]*)\]/.exec(fuente)?.[1] ?? "";
    for (const status of STATUSES_TOOL) {
      expect(list.includes(`"${status}"`), status).toBe(true);
    }
  });
});



function wrapOfApproval() {
  return approvalMiddleware.wrapToolCall as unknown as (
    request: unknown,
    handler: Handler,
  ) => Promise<ToolMessage>;
}

function prompt(name: string, args: Record<string, unknown>, toolCallId: string) {
  return {
    toolCall: { name: name, args, id: toolCallId, type: "tool_call" },
    runtime: { configurable: { thread_id: "chat-expires:msg-1" } },
    tool: undefined,
    state: { messages: [] },
  };
}

function contextWithChannel(role: string, events: EventSse[]): RequestUser {
  return {
    id: "u1",
    username: `test_${role.toLowerCase()}`,
    role,
    approvalChannel: {
      chatId: "chat-expires",
      emit: (event: string, data: unknown) => events.push({ event, data }),
    },
  } as RequestUser;
}


async function pedirApproval(toolCallId: string) {
  const events: EventSse[] = [];
  let run = false;
  const handler: Handler = async () => {
    run = true;
    return new ToolMessage({ content: "EJECUTADA", tool_call_id: toolCallId, name: "deleteCronJob" });
  };
  const promptPromise = requestContext.run(contextWithChannel("ADMIN", events), () =>
    wrapOfApproval()(prompt("deleteCronJob", { id: "job-1" }, toolCallId), handler),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  const emitted = events.find((event) => event.event === "tool_approval_required");
  const pending = approvalBroker
    .listByChat("chat-expires")
    .filter((snap) => snap.status === "pending")
    .pop();
  return {
    emitted,
    pending,
    promptPromise,
    events,
    
    wasRun: () => run,
  };
}

afterEach(() => {
  approvalBroker.clear();
  resetApprovalAttempts();
});

describe("payload de aprobación HITL", () => {
  it("tool_approval_required incluye expiresAt utilizable por la UI", async () => {
    const { emitted, pending, promptPromise, wasRun } =
      await pedirApproval("tc-exp");

    expect(emitted).toBeDefined();
    const payload = emitted!.data as Record<string, unknown>;

    expect(typeof payload.approvalId).toBe("string");
    expect(payload.toolCallId).toBe("tc-exp");
    expect(payload.name).toBe("deleteCronJob");

    expect(typeof payload.expiresAt, "expiresAt ausente en el payload SSE").toBe("string");
    const expira = new Date(String(payload.expiresAt));
    expect(Number.isNaN(expira.getTime()), `expiresAt no parseable: ${payload.expiresAt}`).toBe(false);
    expect(expira.getTime()).toBeGreaterThan(Date.now());
    expect(pending).toBeDefined();
    expect(String(payload.expiresAt)).toBe(new Date(pending!.expiresAt).toISOString());

    expect(expira.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);

    approvalBroker.resolve(String(payload.approvalId), "approved", { id: "u1" });
    const mensaje = await promptPromise;
    expect(String(mensaje.content)).toBe("EJECUTADA");
    expect(wasRun()).toBe(true);
  });

  it("el snapshot del broker expone expiresAt y la decisión lo deja de ser pendiente", async () => {
    const { pending, promptPromise } = await pedirApproval("tc-exp-2");
    expect(typeof pending?.expiresAt).toBe("number");
    expect(pending!.expiresAt).toBeGreaterThan(Date.now());

    approvalBroker.resolve(pending!.approvalId, "rejected", { id: "u1" });
    const mensaje = await promptPromise;
    expect(String(mensaje.content).startsWith(APPROVAL_MESSAGE_PREFIXES.rejected)).toBe(true);

    const after = approvalBroker.get(pending!.approvalId);
    expect(after?.status).toBe("rejected");
    expect(after?.expiresAt).toBe(pending!.expiresAt);
  });
});
