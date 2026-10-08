import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { adminBearer, createTestUser, publicApi, removeTestUser, sessionFor } from "./helpers";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  NIVELES_AGENTE_CANONICOS,
  NIVELES_LOG_CANONICOS,
  NIVEL_AGENTE,
  type ContextoLogAgente,
  cacheDeLogsDeAgenteVencido,
  establecerCacheLogsDeAgente,
  logsDeAgenteActivos,
  observarEventoDeAgente,
  pendientesDeLog,
  refrescarLogsDeAgente,
  registrarFinDeTurno,
  registrarInicioDeTurno,
  vaciarColaDeLogs,
} from "@/agent/deep/agentLog";




const MARKER = `TEST_AGENTLOG_${Date.now()}`;

const LEVEL_LIBRE = `${MARKER}_NIVEL_LIBRE`;

const CHAT_A = `${MARKER}_CHAT_A`;
const CHAT_B = `${MARKER}_CHAT_B`;

const NIVELES_AGENT_ESPERADOS = [
  "AGENT_TURN",
  "AGENT_PLAN",
  "AGENT_DELEGATION",
  "AGENT_TOOL",
  "AGENT_SKILL",
  "AGENT_RAG",
  "AGENT_APPROVAL",
];

const NIVELES_PREEXISTENTES_ESPERADOS = [
  "CREATE",
  "CONFIGURE",
  "INFO",
  "CRON_EXECUTION",
  "ADMIN_ACTION",
  "ERROR",
];




const usersCreated: Array<{ username: string; password: string }> = [];
const idsUsers: string[] = [];

let tracista: { username: string; password: string } = { username: "", password: "" };
let idUserTracista = "";
let agentLogsOriginal = true;


let ctx: ContextoLogAgente;




async function newUser(role: "USER" | "STAFF"): Promise<{ username: string; password: string; id: string }> {
  const credenciales = await createTestUser(role);
  usersCreated.push({ username: credenciales.username, password: credenciales.password });
  const row = await prismaClient.user.findUniqueOrThrow({ where: { username: credenciales.username } });
  idsUsers.push(row.id);
  return { ...credenciales, id: row.id };
}


async function contarLogsOf(userId: string | null): Promise<number> {
  return prismaClient.log.count({ where: { userId } });
}



async function drenarTail(): Promise<void> {
  await vaciarColaDeLogs();
  expect(pendientesDeLog()).toBe(0);
}



const EVENTS_WITHOUT_ROW: Array<{ event: string; payload: unknown }> = [

  { event: "text_delta", payload: { content: " El router R1" } },
  { event: "reasoning", payload: { content: "Primero compruebo la tabla de rutas." } },

  { event: "tool_call_chunks", payload: { name: "read_file", index: 0, args: '{"file_pa' } },

  { event: "user_message", payload: { id: "msg-1", content: "¿Cuál es el estado de R1?", role: "user" } },

  { event: "complete", payload: { id: "msg-2", content: "Listo.", role: "assistant" } },

  { event: "handoff", payload: { from: "general", to: "network-specialist" } },

  { event: "admin_action", payload: { action: "crear_cronjob", target: "backup-diario", actor: "nelson" } },

  { event: "error", payload: { message: "Fallo al ejecutar la tool", code: "TOOL_FAILED" } },

  { event: "evento_inventado_de_prueba", payload: { content: "no debe aparecer", level: "AGENT_TOOL" } },
];



const EVENTS_WITH_ROW: Array<{
  event: string;
  payload: unknown;
  level: string;
  title: string;
}> = [
  {
    event: "plan_update",
    payload: {
      todos: [
        { id: "t1", content: "Analizar la topología", status: "completed" },
        { id: "t2", content: "Aplicar los cambios", status: "pending" },
      ],
    },
    level: NIVEL_AGENTE.PLAN,
    title: "Plan actualizado (2 pasos)",
  },
  {
    event: "subagent_started",
    payload: { name: "network-specialist", task: "Revisar la configuración de OSPF" },
    level: NIVEL_AGENTE.DELEGACION,
    title: "Delegación → network-specialist",
  },
  {
    event: "subagent_completed",
    payload: { name: "network-specialist", summary: "La delegación terminó con error." },
    level: NIVEL_AGENTE.DELEGACION,
    title: "Delegación finalizada → network-specialist",
  },
  {
    event: "skill_loading",
    payload: { skillName: "ospf-diagnostico", description: "Diagnóstico de OSPF" },
    level: NIVEL_AGENTE.SKILL,
    title: "Skill cargando → ospf-diagnostico",
  },
  {
    event: "skill_loaded",
    payload: { skillName: "ospf-diagnostico" },
    level: NIVEL_AGENTE.SKILL,
    title: "Skill cargada → ospf-diagnostico",
  },
  {
    event: "skill_created",
    payload: { title: "Nueva skill de pruebas", skillId: "skill-abc" },
    level: NIVEL_AGENTE.SKILL,
    title: "Skill creada → Nueva skill de pruebas",
  },
  {
    event: "rag_retrieved",
    payload: { sources: ["Manual de OSPF", "Guía BGP"], chunksUsed: 2 },
    level: NIVEL_AGENTE.RAG,
    title: "RAG: 2 fuentes",
  },
  {
    event: "tool_call_start",
    payload: { id: "call-1", name: "read_file", input: { file_path: "/skills/ospf-diagnostico/SKILL.md" } },
    level: NIVEL_AGENTE.TOOL,
    title: "Tool → read_file",
  },
  {
    event: "tool_call_result",
    payload: {
      id: "call-1",
      name: "read_file",
      input: { file_path: "/skills/ospf-diagnostico/SKILL.md" },
      output: "contenido",
      status: "completed",
    },
    level: NIVEL_AGENTE.TOOL,
    title: "Tool read_file → completed",
  },
  {
    event: "tool_approval_required",
    payload: {
      toolLabel: "write_config",
      summary: "Escribir la configuración",
      commands: ["conf t"],
      risk: "medium",
    },
    level: NIVEL_AGENTE.APROBACION,
    title: "Aprobación requerida → write_config",
  },
  {
    event: "tool_approval_resolved",
    payload: { toolCallId: "call-42", decision: "approved" },
    level: NIVEL_AGENTE.APROBACION,
    title: "Aprobación aprobada → call-42",
  },
  {
    event: "terminal_command",
    payload: { commands: ["show ip interface brief"], deviceName: "R1", name: "send_command" },
    level: NIVEL_AGENTE.TOOL,
    title: "Comando enviado a la consola",
  },
];



beforeAll(async () => {

  tracista = await newUser("USER");
  idUserTracista = tracista.id;

  const config = await prismaClient.configuration.findFirst({ select: { agentLogsEnabled: true } });
  agentLogsOriginal = config?.agentLogsEnabled ?? true;

  ctx = {
    userId: idUserTracista,
    chatId: `${MARKER}_CHAT_CTX`,
    threadId: `${MARKER}_THREAD`,
    actor: { username: tracista.username, role: "STAFF" },
    model: "modelo-de-prueba",
    origen: "chat",
  };
});

beforeEach(() => {

  establecerCacheLogsDeAgente(true);
});

afterEach(() => {

  establecerCacheLogsDeAgente(true);
});

afterAll(async () => {

  await vaciarColaDeLogs();
  if (pendientesDeLog() !== 0) {
    throw new Error(`La cola de traza del agente quedó con ${pendientesDeLog()} entradas sin volcar`);
  }


  await prismaClient.log.deleteMany({ where: { userId: { in: idsUsers } } });
  await prismaClient.log.deleteMany({ where: { level: { startsWith: MARKER } } });


  await prismaClient.configuration.updateMany({ data: { agentLogsEnabled: agentLogsOriginal } });
  establecerCacheLogsDeAgente(agentLogsOriginal);


  for (const user of usersCreated) await removeTestUser(user.username);


  const sobrantes = await prismaClient.log.count({ where: { level: { startsWith: MARKER } } });
  if (sobrantes > 0) throw new Error(`Quedan ${sobrantes} filas de la suite de traza del agente`);
});



describe("agentLog / vocabulario de niveles", () => {
  it("declara exactamente los siete niveles AGENT_* del agente", () => {
    expect(NIVELES_AGENTE_CANONICOS).toEqual(NIVELES_AGENT_ESPERADOS);
    expect(NIVELES_AGENTE_CANONICOS).toHaveLength(7);
  });

  it("incluye los siete niveles del agente en NIVELES_LOG_CANONICOS sin duplicados", () => {
    for (const level of NIVELES_AGENT_ESPERADOS) {
      expect(NIVELES_LOG_CANONICOS).toContain(level);
    }
    expect(new Set(NIVELES_LOG_CANONICOS).size).toBe(NIVELES_LOG_CANONICOS.length);
  });

  it("conserva los niveles preexistentes del historial de auditoría", () => {
    for (const level of NIVELES_PREEXISTENTES_ESPERADOS) {
      expect(NIVELES_LOG_CANONICOS).toContain(level);
    }
  });

  it("reutiliza el nivel ERROR ya existente para el turno fallido", () => {

    expect(NIVEL_AGENTE.ERROR).toBe("ERROR");
    expect(NIVELES_AGENTE_CANONICOS).not.toContain("ERROR");
    expect(NIVELES_LOG_CANONICOS).toContain(NIVEL_AGENTE.ERROR);
  });
});



describe("agentLog / whitelist de eventos", () => {
  for (const caso of EVENTS_WITHOUT_ROW) {
    it(`ignora \`${caso.event}\` y no escribe ninguna fila`, async () => {
      const before = await contarLogsOf(idUserTracista);
      observarEventoDeAgente(ctx, caso.event, caso.payload);
      await drenarTail();
      expect(await contarLogsOf(idUserTracista)).toBe(before);
    });
  }

  it("no escribe ninguna fila aunque el turno emita cientos de fragmentos de texto y razonamiento", async () => {
    
    
    const before = await contarLogsOf(idUserTracista);
    for (let i = 0; i < 250; i++) {
      observarEventoDeAgente(ctx, "text_delta", { content: ` fragmento-${i}` });
      observarEventoDeAgente(ctx, "reasoning", { content: ` razonamiento-${i}` });
    }
    await drenarTail();
    expect(await contarLogsOf(idUserTracista)).toBe(before);
  });

  for (const caso of EVENTS_WITH_ROW) {
    it(`registra exactamente una fila ${caso.level} para \`${caso.event}\``, async () => {
      const before = await contarLogsOf(idUserTracista);
      observarEventoDeAgente(ctx, caso.event, caso.payload);
      await drenarTail();

      expect((await contarLogsOf(idUserTracista)) - before).toBe(1);
      const row = await prismaClient.log.findFirst({
        where: { userId: idUserTracista, level: caso.level, title: caso.title },
        orderBy: { createdAt: "desc" },
      });
      expect(row).not.toBeNull();
    });
  }
});



describe("agentLog / contenido y columnas de la fila", () => {
  it("guarda userId y chatId del contexto y compone la cabecera de metadatos sin repetirlos", async () => {
    observarEventoDeAgente(ctx, "tool_call_result", {
      id: "call-1",
      name: "read_file",
      input: { file_path: "/skills/ospf-diagnostico/SKILL.md" },
      output: "# Diagnóstico OSPF",
      status: "completed",
    });
    await drenarTail();

    const row = await prismaClient.log.findFirst({
      where: {
        userId: idUserTracista,
        level: NIVEL_AGENTE.TOOL,
        title: "Tool read_file → completed",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.userId).toBe(idUserTracista);
    expect(row!.chatId).toBe(ctx.chatId);
    expect(row!.level).toBe(NIVEL_AGENTE.TOOL);

    
    
    const [cabecera] = row!.content.split("\n");
    expect(cabecera).toContain(`hilo=${ctx.threadId}`);
    expect(cabecera).toContain(`modelo=${ctx.modelo}`);
    expect(cabecera).toContain(`origen=${ctx.origen}`);
    expect(cabecera).toContain(`actor=${tracista.username} (STAFF)`);


    expect(row!.content).not.toContain("userId=");
    expect(row!.content).not.toContain("chatId=");


    expect(row!.content).toContain("output=");
  });

  it("acota el content aunque la salida de la tool sea enorme", async () => {
    observarEventoDeAgente(ctx, "tool_call_result", {
      name: "search_knowledge_base",
      input: { query: "ospf" },
      output: "X".repeat(50_000),
      status: "completed",
    });
    await drenarTail();

    const row = await prismaClient.log.findFirst({
      where: {
        userId: idUserTracista,
        level: NIVEL_AGENTE.TOOL,
        title: "Tool search_knowledge_base → completed",
      },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    expect(row!.content.length).toBeLessThanOrEqual(2000);

    expect(row!.content.endsWith("…")).toBe(true);
  });

  it("no escribe un `plan_update` sin pasos normalizables", async () => {
    const before = await contarLogsOf(idUserTracista);
    observarEventoDeAgente(ctx, "plan_update", { todos: [] });
    observarEventoDeAgente(ctx, "plan_update", {});
    await drenarTail();
    expect(await contarLogsOf(idUserTracista)).toBe(before);
  });
});



describe("agentLog / ciclo de vida del turno", () => {
  it("deja dos hitos AGENT_TURN al completar el turno, con duración y nº de tools en el cierre", async () => {
    const before = await contarLogsOf(idUserTracista);
    registrarInicioDeTurno(ctx, { prompt: "Revisar el estado de OSPF", route: "supervisor" });
    registrarFinDeTurno(ctx, {
      result: "completo",
      duracionMs: 4321,
      toolCalls: 3,
      tokensInput: 1200,
      tokensOutput: 340,
      pasosPending: 0,
      reply: "OSPF está configurado correctamente.",
    });
    await drenarTail();

    expect((await contarLogsOf(idUserTracista)) - before).toBe(2);

    const start = await prismaClient.log.findFirst({
      where: { userId: idUserTracista, level: NIVEL_AGENTE.TURNO, title: "Turno iniciado" },
      orderBy: { createdAt: "desc" },
    });
    expect(start).not.toBeNull();
    expect(start!.content).toContain("Revisar el estado de OSPF");
    expect(start!.content).toContain("ruta=supervisor");

    const end = await prismaClient.log.findFirst({
      where: { userId: idUserTracista, level: NIVEL_AGENTE.TURNO, title: "Turno completado" },
      orderBy: { createdAt: "desc" },
    });
    expect(end).not.toBeNull();
    expect(end!.content).toContain("duracionMs=4321");
    expect(end!.content).toContain("toolCalls=3");
    expect(end!.content).toContain("tokensEntrada=1200");
    expect(end!.content).toContain("resultado=completo");
  });

  it("registra el turno fallido con el nivel ERROR, no con AGENT_TURN", async () => {
    const turnsBefore = await prismaClient.log.count({
      where: { userId: idUserTracista, level: NIVEL_AGENTE.TURNO },
    });
    registrarFinDeTurno(ctx, {
      result: "error",
      duracionMs: 87,
      toolCalls: 1,
      error: "El modelo no respondió",
    });
    await drenarTail();


    const turnsAfter = await prismaClient.log.count({
      where: { userId: idUserTracista, level: NIVEL_AGENTE.TURNO },
    });
    expect(turnsAfter).toBe(turnsBefore);

    const fallido = await prismaClient.log.findFirst({
      where: { userId: idUserTracista, level: NIVEL_AGENTE.ERROR, title: "Turno fallido" },
      orderBy: { createdAt: "desc" },
    });
    expect(fallido).not.toBeNull();
    expect(fallido!.content).toContain("duracionMs=87");
    expect(fallido!.content).toContain("error=El modelo no respondió");
    expect(fallido!.content).toContain("resultado=error");
  });
});



describe("agentLog / interruptor Configuration.agentLogsEnabled", () => {
  it("no escribe nada con la traza desactivada y vuelve a escribir al reactivarla", async () => {
    const before = await contarLogsOf(idUserTracista);

    establecerCacheLogsDeAgente(false);
    expect(logsDeAgenteActivos()).toBe(false);


    observarEventoDeAgente(ctx, "tool_call_start", { id: "call-x", name: "read_file", input: {} });
    observarEventoDeAgente(ctx, "plan_update", { todos: [{ content: "Paso ignorado", status: "pending" }] });
    registrarInicioDeTurno(ctx, { prompt: "Este turno no debe dejar rastro" });
    registrarFinDeTurno(ctx, { result: "completo", duracionMs: 10, toolCalls: 0 });
    await drenarTail();
    expect(await contarLogsOf(idUserTracista)).toBe(before);

    establecerCacheLogsDeAgente(true);
    expect(logsDeAgenteActivos()).toBe(true);
    observarEventoDeAgente(ctx, "tool_call_start", { id: "call-y", name: "read_file", input: {} });
    await drenarTail();
    expect((await contarLogsOf(idUserTracista)) - before).toBe(1);
  });

  it("deja la caché fresca al fijar el valor a mano", async () => {
    establecerCacheLogsDeAgente(true);
    expect(cacheDeLogsDeAgenteVencido()).toBe(false);
    establecerCacheLogsDeAgente(false);
    expect(cacheDeLogsDeAgenteVencido()).toBe(false);
  });

  it("refresca el valor desde la base con `refrescarLogsDeAgente(true)`", async () => {
    await prismaClient.configuration.updateMany({ data: { agentLogsEnabled: false } });
    const apagado = await refrescarLogsDeAgente(true);
    expect(apagado).toBe(false);
    expect(logsDeAgenteActivos()).toBe(false);

    await prismaClient.configuration.updateMany({ data: { agentLogsEnabled: true } });
    const encendido = await refrescarLogsDeAgente(true);
    expect(encendido).toBe(true);
    expect(logsDeAgenteActivos()).toBe(true);
  });
});



describe("Logs /api/logs aislamiento por usuario", () => {
  it("cada usuario solo ve sus filas, el log del sistema solo lo ve el ADMIN y filtra por level y chatId", async () => {
    const userB = await newUser("USER");
    const logA = await prismaClient.log.create({
      data: {
        level: MARKER,
        title: `Log de ${MARKER} A`,
        content: "contenido A",
        userId: idUserTracista,
        chatId: CHAT_A,
      },
    });
    const logB = await prismaClient.log.create({
      data: {
        level: MARKER,
        title: `Log de ${MARKER} B`,
        content: "contenido B",
        userId: userB.id,
        chatId: CHAT_B,
      },
    });
    const logSystem = await prismaClient.log.create({
      data: {
        level: MARKER,
        title: `Log de ${MARKER} sistema`,
        content: "contenido del sistema",
        userId: null,
        chatId: null,
      },
    });

    const sessionA = await sessionFor(tracista.username, tracista.password);
    const sessionB = await sessionFor(userB.username, userB.password);
    const bearer = await adminBearer();


    const listA = await sessionA.get(`/api/logs?level=${MARKER}`);
    expect(listA.status).toBe(200);
    const idsA = (listA.body.data.items as Array<{ id: string }>).map((item) => item.id);
    expect(idsA).toContain(logA.id);
    expect(idsA).not.toContain(logB.id);
    expect(idsA).not.toContain(logSystem.id);


    const itemA = (
      listA.body.data.items as Array<{ id: string; actor: { username: string; role: string } }>
    ).find((item) => item.id === logA.id);
    expect(itemA!.actor.username).toBe(tracista.username);
    expect(itemA!.actor.role).toBe("USER");


    const listB = await sessionB.get(`/api/logs?level=${MARKER}`);
    expect(listB.status).toBe(200);
    const idsB = (listB.body.data.items as Array<{ id: string }>).map((item) => item.id);
    expect(idsB).toContain(logB.id);
    expect(idsB).not.toContain(logA.id);
    expect(idsB).not.toContain(logSystem.id);


    const byChatForeign = await sessionA.get(`/api/logs?level=${MARKER}&chatId=${CHAT_B}`);
    expect(byChatForeign.status).toBe(200);
    expect(byChatForeign.body.data.items).toHaveLength(0);

    const byChatOwn = await sessionA.get(`/api/logs?level=${MARKER}&chatId=${CHAT_A}`);
    expect(byChatOwn.body.data.total).toBe(1);
    expect((byChatOwn.body.data.items as Array<{ id: string }>)[0].id).toBe(logA.id);


    const listAdmin = await publicApi().get(`/api/logs?level=${MARKER}`).set("Authorization", bearer);
    expect(listAdmin.status).toBe(200);
    const idsAdmin = (listAdmin.body.data.items as Array<{ id: string }>).map((item) => item.id);
    expect(idsAdmin).toContain(logA.id);
    expect(idsAdmin).toContain(logB.id);
    expect(idsAdmin).toContain(logSystem.id);
    expect(listAdmin.body.data.total).toBe(3);


    const itemSystem = (listAdmin.body.data.items as Array<{ id: string; actor: unknown }>).find(
      (item) => item.id === logSystem.id,
    );
    expect(itemSystem!.actor).toBeNull();
  });
});



describe("GET /api/logs/levels", () => {
  it("devuelve los niveles canónicos y también los niveles libres presentes en la tabla", async () => {
    const bearer = await adminBearer();
    await prismaClient.log.create({
      data: { level: LEVEL_LIBRE, title: `Nivel libre de ${MARKER}`, content: "contenido" },
    });

    const reply = await publicApi().get("/api/logs/levels").set("Authorization", bearer);
    expect(reply.status).toBe(200);
    const niveles = reply.body.data as string[];

    for (const level of NIVELES_LOG_CANONICOS) {
      expect(niveles).toContain(level);
    }

    expect(NIVELES_LOG_CANONICOS).not.toContain(LEVEL_LIBRE);
    expect(niveles).toContain(LEVEL_LIBRE);

    expect(niveles.slice(0, NIVELES_LOG_CANONICOS.length)).toEqual(NIVELES_LOG_CANONICOS);
    expect(new Set(niveles).size).toBe(niveles.length);
  });
});



describe("PUT /api/config/logs", () => {
  it("el ADMIN cambia el interruptor, GET /api/config lo refleja y un STAFF recibe 403", async () => {
    const staff = await newUser("STAFF");
    const sessionStaff = await sessionFor(staff.username, staff.password);
    const bearer = await adminBearer();

    const prohibido = await sessionStaff.put("/api/config/logs").send({ agentLogsEnabled: false });
    expect(prohibido.status).toBe(403);

    const apagado = await publicApi()
      .put("/api/config/logs")
      .set("Authorization", bearer)
      .send({ agentLogsEnabled: false });
    expect(apagado.status).toBe(200);
    expect(apagado.body.data.agentLogsEnabled).toBe(false);

    expect(logsDeAgenteActivos()).toBe(false);

    const configApagada = await publicApi().get("/api/config").set("Authorization", bearer);
    expect(configApagada.status).toBe(200);
    expect(configApagada.body.data.agentLogsEnabled).toBe(false);

    const encendido = await publicApi()
      .put("/api/config/logs")
      .set("Authorization", bearer)
      .send({ agentLogsEnabled: true });
    expect(encendido.status).toBe(200);
    expect(encendido.body.data.agentLogsEnabled).toBe(true);
    expect(logsDeAgenteActivos()).toBe(true);

    const configEncendida = await publicApi().get("/api/config").set("Authorization", bearer);
    expect(configEncendida.status).toBe(200);
    expect(configEncendida.body.data.agentLogsEnabled).toBe(true);


    await publicApi()
      .put("/api/config/logs")
      .set("Authorization", bearer)
      .send({ agentLogsEnabled: agentLogsOriginal });
  });
});
