

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import {
  APPROVAL_MESSAGE_PREFIXES,
  approvalMiddleware,
  resetApprovalAttempts,
} from "@/agent/approval/ApprovalMiddleware";
import { approvalBroker } from "@/agent/approval/ApprovalBroker";
import { requestContext, type RequestUser } from "@/utils/RequestContext";
import { buildTurnFiles } from "@/agent/deep/turn";
import type { SkillDocument } from "@/agent/skills/loader";
import { getToolPolicy } from "@/agent/security/ToolPolicy";
import {
  cerrarTurno,
  estimarTokens,
  estimarTokensMensajes,
  limpiarMetricas,
  nuevoTurno,
  registrarNodo,
  resumenRendimiento,
} from "@/agent/deep/metrics";

type Handler = (request: unknown) => Promise<ToolMessage>;

interface EventSse {
  event: string;
  data: unknown;
}


function wrapOfApproval() {
  return approvalMiddleware.wrapToolCall as unknown as (
    request: unknown,
    handler: Handler,
  ) => Promise<ToolMessage>;
}


function prompt(
  name: string,
  args: Record<string, unknown>,
  toolCallId = "tc-1",
) {
  return {
    toolCall: { name: name, args, id: toolCallId, type: "tool_call" },
    runtime: { configurable: { thread_id: "chat-1:msg-1" } },
    tool: undefined,
    state: { messages: [] },
  };
}


function contextWithChannel(
  role: string,
  events: EventSse[],
  extra: Partial<RequestUser> = {},
): RequestUser {
  return {
    id: "u1",
    username: `test_${role.toLowerCase()}`,
    role,
    approvalChannel: {
      chatId: "chat-1",
      emit: (event: string, data: unknown) => events.push({ event, data }),
    },
    ...extra,
  } as RequestUser;
}



function contextCron(extra: Partial<RequestUser> = {}): RequestUser {
  return {
    id: "system",
    username: "cron",
    role: "ADMIN",
    ...extra,
  } as RequestUser;
}


interface Ejecucion {
  mensaje: ToolMessage;
  text: string;
  run: boolean;
}


async function ejecutar(
  ctx: RequestUser,
  name: string,
  args: Record<string, unknown>,
  toolCallId = "tc-1",
): Promise<Ejecucion> {
  let run = false;
  const handler: Handler = async () => {
    run = true;
    return new ToolMessage({
      content: "EJECUTADA",
      tool_call_id: toolCallId,
      name: name,
    });
  };
  const mensaje = await requestContext.run(ctx, () =>
    wrapOfApproval()(prompt(name, args, toolCallId), handler),
  );
  return { mensaje, text: String(mensaje.content ?? ""), run };
}


function eventsOfApproval(events: EventSse[]): EventSse[] {
  return events.filter((e) => e.event.startsWith("tool_approval_"));
}


function pendingEnBroker(chatId: string) {
  const pending = approvalBroker
    .listByChat(chatId)
    .filter((snap) => snap.status === "pending");
  return pending[pending.length - 1];
}

afterEach(() => {
  approvalBroker.clear();
  resetApprovalAttempts();
});

describe("HITL legacy: gate de rol USER", () => {
  it("bloquea una mutación irreversible con motivo estable", async () => {
    const events: EventSse[] = [];
    const { text, run } = await ejecutar(
      contextWithChannel("USER", events),
      "deleteCronJob",
      { id: "job-1" },
    );

    expect(text.startsWith(APPROVAL_MESSAGE_PREFIXES.roleBlocked)).toBe(true);
    expect(text).toContain("STAFF o ADMIN");
    expect(run).toBe(false);

    expect(eventsOfApproval(events)).toHaveLength(0);
  });

  it("bloquea también la tool reversible (autoApprove) y la peligrosa", async () => {
    const events: EventSse[] = [];
    const reversible = await ejecutar(
      contextWithChannel("USER", events),
      "createSkill",
      { title: "owasp" },
    );
    const peligrosa = await ejecutar(
      contextWithChannel("USER", events),
      "send_command",
      { command: "reload" },
    );

    expect(reversible.text.startsWith(APPROVAL_MESSAGE_PREFIXES.roleBlocked)).toBe(true);
    expect(reversible.run).toBe(false);
    expect(peligrosa.text.startsWith(APPROVAL_MESSAGE_PREFIXES.roleBlocked)).toBe(true);
    expect(peligrosa.run).toBe(false);
    expect(eventsOfApproval(events)).toHaveLength(0);
  });

  it("el gate está en el middleware: una tool sin política ni validación de rol también se bloquea", async () => {

    expect(getToolPolicy("tool_del_futuro").access).toBe("mutating");
    const { text, run } = await ejecutar(
      contextWithChannel("USER", []),
      "tool_del_futuro",
      { cualquier: "cosa" },
    );

    expect(text.startsWith(APPROVAL_MESSAGE_PREFIXES.roleBlocked)).toBe(true);
    expect(run).toBe(false);
  });

  it("un USER sí puede leer (las tools readonly nunca se bloquean)", async () => {
    const read = await ejecutar(
      contextWithChannel("USER", []),
      "read_terminal",
      { lines: 10 },
    );
    const topology = await ejecutar(
      contextWithChannel("USER", []),
      "getNetwork",
      {},
    );

    expect(read.run).toBe(true);
    expect(topology.run).toBe(true);
  });

  it("STAFF y ADMIN no reciben el bloqueo por rol", async () => {

    for (const role of ["STAFF", "ADMIN"]) {
      const { text, run } = await ejecutar(
        contextWithChannel(role, []),
        "createSkill",
        { title: "owasp" },
        `tc-${role}`,
      );
      expect(text, role).not.toContain(APPROVAL_MESSAGE_PREFIXES.roleBlocked);
      expect(run, role).toBe(true);
    }
  });
});

describe("HITL legacy: mutación con aprobación pendiente", () => {
  it("no ejecuta hasta que el usuario aprueba y emite la tarjeta", async () => {
    const events: EventSse[] = [];
    const ctx = contextWithChannel("ADMIN", events);

    const promptPromise = ejecutar(ctx, "deleteCronJob", { id: "job-1" });

    let resolved = false;
    void promptPromise.then(() => {
      resolved = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(resolved).toBe(false);

    const tarjeta = pendingEnBroker("chat-1")!;
    expect(tarjeta.status).toBe("pending");
    const emitted = eventsOfApproval(events).find(
      (e) => e.event === "tool_approval_required",
    );
    expect(emitted).toBeDefined();
    expect((emitted?.data as { name: string }).name).toBe("deleteCronJob");

    approvalBroker.resolve(tarjeta.approvalId, "approved", { id: "u1" });
    const result = await promptPromise;
    expect(result.run).toBe(true);
    expect(result.text).toBe("EJECUTADA");
    expect(
      eventsOfApproval(events).some((e) => e.event === "tool_approval_resolved"),
    ).toBe(true);
  });

  it("al rechazar, la tool no se ejecuta y el modelo recibe el motivo", async () => {
    const events: EventSse[] = [];
    const ctx = contextWithChannel("ADMIN", events);

    const promptPromise = ejecutar(ctx, "deleteCronJob", { id: "job-1" }, "tc-rechazo");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const tarjeta = pendingEnBroker("chat-1")!;
    approvalBroker.resolve(tarjeta.approvalId, "rejected", { id: "u1" });

    const { text, run } = await promptPromise;
    expect(run).toBe(false);
    expect(text.startsWith(APPROVAL_MESSAGE_PREFIXES.rejected)).toBe(true);
    expect(text).toContain("rechazó");
  });

  it("acumula rechazos y corta el reintento al tercero", async () => {
    const events: EventSse[] = [];
    const ctx = contextWithChannel("ADMIN", events);

    const reject = async (toolCallId: string) => {
      const promptPromise = ejecutar(ctx, "deleteCronJob", { id: "job-1" }, toolCallId);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const tarjeta = pendingEnBroker("chat-1")!;
      approvalBroker.resolve(tarjeta.approvalId, "rejected", { id: "u1" });
      return promptPromise;
    };

    const first = await reject("tc-1");
    expect(first.text).not.toContain("DETENTE");

    const second = await reject("tc-2");
    expect(second.text).toContain("DETENTE");
    expect(second.text).toContain("2 rechazos");


    const third = await ejecutar(ctx, "deleteCronJob", { id: "job-1" }, "tc-3");
    expect(third.run).toBe(false);
    expect(third.text).toContain("límite de intentos bloqueados");
    expect(
      eventsOfApproval(events).filter((e) => e.event === "tool_approval_required"),
    ).toHaveLength(2);
  });

  it("resetApprovalAttempts(chatId) reabre el ciclo de un chat", async () => {
    const events: EventSse[] = [];
    const ctx = contextWithChannel("ADMIN", events);

    const reject = async (toolCallId: string) => {
      const promptPromise = ejecutar(ctx, "deleteCronJob", { id: "job-1" }, toolCallId);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const tarjeta = pendingEnBroker("chat-1")!;
      approvalBroker.resolve(tarjeta.approvalId, "rejected", { id: "u1" });
      return promptPromise;
    };

    await reject("tc-1");
    await reject("tc-2");
    resetApprovalAttempts("chat-1");

    const promptPromise = ejecutar(ctx, "deleteCronJob", { id: "job-1" }, "tc-3");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const tarjeta = pendingEnBroker("chat-1")!;
    expect(tarjeta.status).toBe("pending");
    approvalBroker.resolve(tarjeta.approvalId, "approved", { id: "u1" });
    expect((await promptPromise).run).toBe(true);
  });
});

describe("HITL legacy: auto-aprobación de mutaciones reversibles", () => {
  it("no pide aprobación para crear/editar (autoApprove)", async () => {
    for (const tool of ["createSkill", "createCronJob", "updateDeviceProvider"]) {
      expect(getToolPolicy(tool).autoApprove, tool).toBe(true);
      const events: EventSse[] = [];
      const { run, text } = await ejecutar(
        contextWithChannel("ADMIN", events),
        tool,
        { name: "x" },
        `tc-${tool}`,
      );
      expect(run, tool).toBe(true);
      expect(text, tool).toBe("EJECUTADA");
      expect(eventsOfApproval(events), tool).toHaveLength(0);
    }
  });

  it("un lote CLI de solo lectura también pasa directo", async () => {
    const events: EventSse[] = [];
    const { run } = await ejecutar(
      contextWithChannel("ADMIN", events),
      "send_command",
      { command: "show ip interface brief" },
    );
    expect(run).toBe(true);
    expect(eventsOfApproval(events)).toHaveLength(0);
  });
});

describe("HITL legacy: modo autónomo (cron) sin canal de aprobación", () => {
  it("auto-aprueba la mutación no peligrosa y no registra nada en el broker", async () => {
    const { run, text } = await ejecutar(
      contextCron(),
      "send_command",
      { command: "configure terminal" },
    );
    expect(run).toBe(true);
    expect(text).toBe("EJECUTADA");

    for (const snap of approvalBroker.listByChat("chat-1")) {
      expect(snap.status).not.toBe("pending");
    }
  });

  it("bloquea el comando peligroso sin colgarse esperando al broker", async () => {
    const start = Date.now();
    const { text, run } = await ejecutar(
      contextCron(),
      "send_command",
      { command: "write erase" },
    );
    expect(Date.now() - start).toBeLessThan(2000);
    expect(run).toBe(false);
    expect(text.startsWith(APPROVAL_MESSAGE_PREFIXES.rejected)).toBe(true);
    expect(text).toContain("destructivo");
  });

  it("en el cron, la mutación interna irreversible se auto-aprueba con auditoría", async () => {

    const { run, text } = await ejecutar(contextCron(), "deleteSkill", {
      id: "s1",
    });
    expect(run).toBe(true);
    expect(text).toBe("EJECUTADA");
  });

  it("con `autonomous` y canal, lo peligroso sí llega al HITL real", async () => {
    const events: EventSse[] = [];
    const ctx = contextWithChannel("ADMIN", events, { autonomous: true });
    const promptPromise = ejecutar(ctx, "send_command", { command: "reload" });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const tarjeta = pendingEnBroker("chat-1")!;
    expect(tarjeta.status).toBe("pending");
    approvalBroker.resolve(tarjeta.approvalId, "rejected", { id: "u1" });

    const { text, run } = await promptPromise;
    expect(run).toBe(false);
    expect(text.startsWith(APPROVAL_MESSAGE_PREFIXES.rejected)).toBe(true);
  });

  it("con `autonomous` y canal, lo no peligroso se auto-aprueba sin tarjeta", async () => {
    const events: EventSse[] = [];
    const { run } = await ejecutar(
      contextWithChannel("ADMIN", events, { autonomous: true }),
      "send_command",
      { command: "configure terminal" },
    );
    expect(run).toBe(true);
    expect(eventsOfApproval(events)).toHaveLength(0);
  });

  it("el gate de rol manda también en autónomo: un USER no muta nunca", async () => {
    const { text, run } = await ejecutar(
      contextWithChannel("USER", [], { autonomous: true }),
      "deleteSkill",
      { id: "s1" },
    );
    expect(text.startsWith(APPROVAL_MESSAGE_PREFIXES.roleBlocked)).toBe(true);
    expect(run).toBe(false);
  });
});

describe("V21: skills del turno acotadas en state.files", () => {
  const skill = (name: string, chars: number, edad = 0): SkillDocument => ({
    id: name,
    name,
    description: `Skill ${name}`,
    path: `/skills/${name}/SKILL.md`,
    content: "x".repeat(chars),
    updatedAt: new Date(Date.now() - edad * 60_000),
  });

  it("proyecta cada skill en su ruta /skills/<slug>/SKILL.md", () => {
    const files = buildTurnFiles([skill("ospf", 100), skill("bgp", 200)]);
    expect(Object.keys(files).sort()).toEqual([
      "/skills/bgp/SKILL.md",
      "/skills/ospf/SKILL.md",
    ]);
    expect(files["/skills/ospf/SKILL.md"].mimeType).toBe("text/markdown");
  });

  it("prioriza la skill solicitada por @skill:<slug> y le da presupuesto completo", () => {
    const long = skill("larga", 30_000);
    const short = skill("corta", 100, 5);
    const files = buildTurnFiles([long, short], "corta");

    expect(files["/skills/corta/SKILL.md"].content).toHaveLength(100);
    expect(files["/skills/larga/SKILL.md"].content.length).toBeGreaterThan(100);
  });

  it("recorta el contenido con tope por skill y marca el truncado", () => {
    const files = buildTurnFiles([skill("enorme", 200_000)]);
    const content = files["/skills/enorme/SKILL.md"].content;
    expect(content.length).toBeLessThan(200_000);
    expect(content).toContain("AVISO: SKILL.md truncado");
  });

  it("respeta el tope global del turno", () => {
    const muchas = Array.from({ length: 40 }, (_, i) =>
      skill(`s${i}`, 24_000, i),
    );
    const files = buildTurnFiles(muchas);
    const total = Object.values(files).reduce(
      (sum, f) => sum + f.content.length,
      0,
    );

    expect(Object.keys(files)).toHaveLength(5);
    expect(total).toBeLessThanOrEqual(120_000 + 200);
  });
});

describe("D1: el HITL nativo está retirado", () => {
  const raizDeep = join(process.cwd(), "src", "agent", "deep");

  it("no existen los módulos nativos", () => {
    for (const modulo of [
      "nativePolicy.ts",
      "nativeHitl.ts",
      "hitlBridge.ts",
      "checkpointer.ts",
    ]) {
      expect(existsSync(join(raizDeep, modulo)), modulo).toBe(false);
    }
  });

  it("el supervisor y el runner no cablean interruptOn ni checkpointer", () => {

    const withoutComentarios = (fuente: string) =>
      fuente
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const archivo of ["DeepSupervisor.ts", "turn.ts"]) {
      const code = withoutComentarios(
        readFileSync(join(raizDeep, archivo), "utf8"),
      );
      expect(code, archivo).not.toMatch(/interruptOn|checkpointer/i);
      expect(code, archivo).not.toMatch(
        /USE_NATIVE_HITL|nativePolicy|nativeHitl|hitlBridge/,
      );
    }
  });
});

describe("métricas de rendimiento por turno", () => {
  it("estima tokens de texto y de mensajes con tool calls", () => {
    expect(estimarTokens("")).toBe(0);
    expect(estimarTokens("abcd")).toBe(1);
    expect(estimarTokens("a".repeat(400))).toBe(100);

    const withTool = estimarTokensMensajes([
      { content: "hola" },
      { content: "", tool_calls: [{ name: "send_command", args: { command: "reload" } }] },
    ]);
    expect(withTool).toBeGreaterThan(estimarTokens("hola"));
  });

  it("acumula por nodo y agrega el resumen con p95", () => {
    limpiarMetricas();
    for (let i = 0; i < 3; i++) {
      const turn = nuevoTurno({
        chatId: `chat${i}`,
        threadId: `t${i}`,
        role: "ADMIN",
        deep: true,
      });
      registrarNodo(turn, {
        node: "deep_supervisor",
        tokensEntrada: 1000,
        tokensSalida: 200,
        duracionMs: 500 + i * 100,
        toolCalls: 2,
      });
      registrarNodo(turn, {
        node: "ssh_specialist",
        tokensEntrada: 300,
        tokensSalida: 100,
        duracionMs: 900,
        toolCalls: 3,
      });
      cerrarTurno(turn);
    }
    const summary = resumenRendimiento(true);
    expect(summary.turnos).toBe(3);
    expect(summary.tokensMedios).toBe(1300);
    expect(summary.duracionP95Ms).toBe(900);
    limpiarMetricas();
  });


  it("separa el resumen por el campo `deep` (turnos históricos vs actuales)", () => {
    limpiarMetricas();
    const legacy = nuevoTurno({ chatId: "l", threadId: "l", role: "ADMIN", deep: false });
    registrarNodo(legacy, {
      node: "supervisor_node",
      tokensEntrada: 2000,
      tokensSalida: 0,
      duracionMs: 1000,
      toolCalls: 0,
    });
    cerrarTurno(legacy);
    const deep = nuevoTurno({ chatId: "d", threadId: "d", role: "ADMIN", deep: true });
    registrarNodo(deep, {
      node: "deep_supervisor",
      tokensEntrada: 800,
      tokensSalida: 0,
      duracionMs: 700,
      toolCalls: 0,
    });
    cerrarTurno(deep);

    expect(resumenRendimiento(false).tokensMedios).toBe(2000);
    expect(resumenRendimiento(true).tokensMedios).toBe(800);
    limpiarMetricas();
  });
});
