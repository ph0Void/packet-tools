

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { AIMessageChunk } from "@langchain/core/messages";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { server } from "@/app";
import {
  AVISO_PRESUPUESTO,
  AVISO_TURNO_CANCELADO,
  AVISO_TURNO_ERROR,
  anexarAvisoPresupuesto,
  anexarAvisoTurnoIncompleto,
  anexarAvisoTurnoIncompletoSegmento,
  avisoDeTurnoIncompleto,
  codigoDeErrorStream,
  esCancelacionDelCliente,
  type CodigoErrorStream,
} from "@/api/router/continuation";
import {
  cerrarSegmentosPendientes,
  type SegmentoStream,
  type ToolExecution,
} from "@/api/router/ChatsRouter";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";




interface ScriptTurn {
  
  chunks: unknown[];
  
  error?: unknown;
  
  waitAbort?: boolean;
}

const script = vi.hoisted(() => ({
  current: { chunks: [] } as ScriptTurn,
  
  senales: [] as AbortSignal[],
}));

vi.mock("@/agent/deep/turn", () => ({
  createTurnStream: async (args: { signal?: AbortSignal }) => {
    script.senales.push(args.signal as AbortSignal);
    const current = script.current;
    async function* generador() {
      for (const chunk of current.chunks) yield [chunk, {}];
      if (current.waitAbort) {
        
        
        
        while (!args.signal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }
      if (current.error) throw current.error;
    }
    return { stream: generador(), threadId: "hilo-test", deep: false };
  },
  invokeTurn: async () => ({ messages: [], deep: true }),
}));



function text(content: string): AIMessageChunk {
  return new AIMessageChunk({ content });
}


function toolCallParcial(id: string, name: string): AIMessageChunk {
  return new AIMessageChunk({
    content: "",
    tool_call_chunks: [{ id, name, args: '{"commands":["show version"]}' }],
  });
}

interface EventSse {
  event: string;
  data: any;
}


function eventsSse(cuerpo: string): EventSse[] {
  return cuerpo
    .split("\n\n")
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(":"))
    .map((block) => ({
      event: /^event:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? "",
      data: (() => {
        const line = /^data:\s*(.*)$/m.exec(block)?.[1];
        return line ? JSON.parse(line) : null;
      })(),
    }));
}


async function pedirTurn(chatId: string, cookie: string, content: string): Promise<string> {
  const reply = await publicApi()
    .post(`/api/chats/${chatId}/messages`)
    .set("Cookie", cookie)
    .send({ content: content })
    .buffer(true)
    .parse((res: NodeJS.ReadableStream, callback: (err: Error | null, body: string) => void) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        raw += chunk;
      });
      res.on("end", () => callback(null, raw));
    });

  return String(reply.body ?? reply.text ?? "");
}


async function waitMessageAssistant(chatId: string, timeoutMs = 8000) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    const mensaje = await prismaClient.message.findFirst({
      where: { chatId, role: "assistant" },
      orderBy: { createdAt: "desc" },
    });
    if (mensaje) return mensaje;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}



describe("esCancelacionDelCliente: qué es una cancelación y qué no", () => {
  
  const errorLangGraph = new Error("Abort");

  it("reconoce el Error('Abort') del runner de LangGraph", () => {
    expect(esCancelacionDelCliente(errorLangGraph)).toBe(true);
    expect(codigoDeErrorStream(errorLangGraph)).toBe("cancelled");
  });

  it("reconoce AbortError / DOMException del fetch del modelo", () => {
    const domException = Object.assign(new Error("This operation was aborted"), {
      name: "AbortError",
    });
    expect(esCancelacionDelCliente(domException)).toBe(true);
    expect(esCancelacionDelCliente({ name: "AbortError", message: "fetch" })).toBe(true);
    expect(esCancelacionDelCliente({ code: "ABORT_ERR", message: "sin nombre" })).toBe(true);
  });

  it("sigue la cadena de causas (el grafo envuelve el error original)", () => {
    const envuelto = {
      message: "fallo genérico del stream",
      cause: { message: "Request aborted", cause: errorLangGraph },
    };
    expect(esCancelacionDelCliente(envuelto)).toBe(true);
    expect(codigoDeErrorStream(envuelto)).toBe("cancelled");
  });

  it("sin error, solo el signal abortado ya prueba la cancelación", () => {
    const controller = new AbortController();
    controller.abort();
    expect(esCancelacionDelCliente(null, controller.signal)).toBe(true);
    expect(esCancelacionDelCliente(undefined, controller.signal)).toBe(true);
    expect(codigoDeErrorStream(null, controller.signal)).toBe("cancelled");

    expect(esCancelacionDelCliente(null, new AbortController().signal)).toBe(false);
    expect(codigoDeErrorStream(null, new AbortController().signal)).toBe("agent_error");
  });

  it("NO es cancelación el rechazo de una aprobación HITL (GraphInterrupt)", () => {

    const interrupt = { name: "GraphInterrupt", is_bubble_up: true, message: "interrumpido" };
    expect(esCancelacionDelCliente(interrupt)).toBe(false);
    expect(codigoDeErrorStream(interrupt)).toBe("agent_error");
    expect(esCancelacionDelCliente(interrupt, new AbortController().signal)).toBe(false);

    expect(codigoDeErrorStream("[APROBACION_RECHAZADA] el usuario la rechazó")).toBe("agent_error");
  });

  it("un GraphBubbleUp genérico solo cuenta si además abortó el signal", () => {
    const bubbleUp = { name: "Error", is_bubble_up: true, message: "cortado" };
    expect(esCancelacionDelCliente(bubbleUp)).toBe(false);
    const controller = new AbortController();
    controller.abort();
    expect(esCancelacionDelCliente(bubbleUp, controller.signal)).toBe(true);
  });

  it("otros fallos siguen siendo agent_error (nada se reclasifica)", () => {
    expect(codigoDeErrorStream(new Error("API Key inválida (401)"))).toBe("agent_error");
    expect(codigoDeErrorStream(new Error("socket hang up"))).toBe("agent_error");
    expect(codigoDeErrorStream({})).toBe("agent_error");
    expect(codigoDeErrorStream("texto suelto")).toBe("agent_error");
  });
});

describe("regresión: budget_exhausted no se degrada", () => {
  it("sigue siendo budget_exhausted (y gana si el cliente corta a la vez)", () => {
    const controller = new AbortController();
    controller.abort();

    expect(codigoDeErrorStream({ lc_error_code: "GRAPH_RECURSION_LIMIT" })).toBe("budget_exhausted");
    expect(codigoDeErrorStream(new Error("Recursion limit of 15 reached"))).toBe("budget_exhausted");

    expect(codigoDeErrorStream(new Error("Recursion limit of 15 reached"), controller.signal)).toBe(
      "budget_exhausted",
    );
    expect(codigoDeErrorStream({ lc_error_code: "GRAPH_RECURSION_LIMIT" })).not.toBe("cancelled");
  });

  it("el aviso de presupuesto sigue siendo el de siempre", () => {
    expect(anexarAvisoPresupuesto("Parcial")).toBe(`Parcial\n\n${AVISO_PRESUPUESTO}`);
    expect(avisoDeTurnoIncompleto("cancelado")).not.toBe(AVISO_PRESUPUESTO);
  });

  it("el tipo del contrato sigue admitiendo los dos códigos antiguos", () => {
    const codes: CodigoErrorStream[] = ["budget_exhausted", "agent_error", "cancelled"];
    expect(codes).toHaveLength(3);
  });
});



describe("aviso durable de respuesta incompleta", () => {
  it("anexa el aviso del motivo conservando TODO el texto parcial", () => {
    const parcial = "Voy a configurar el router R1 con OSPF";
    const cancelado = anexarAvisoTurnoIncompleto(parcial, "cancelado");
    const fallido = anexarAvisoTurnoIncompleto(parcial, "error");

    expect(cancelado.startsWith(parcial)).toBe(true);
    expect(cancelado).toBe(`${parcial}\n\n${AVISO_TURNO_CANCELADO}`);
    expect(fallido).toBe(`${parcial}\n\n${AVISO_TURNO_ERROR}`);
  });

  it("es idempotente: no duplica el aviso si ya está", () => {
    const unaTime = anexarAvisoTurnoIncompleto("Parcial", "cancelado");
    expect(anexarAvisoTurnoIncompleto(unaTime, "cancelado")).toBe(unaTime);
    expect(unaTime.split(AVISO_TURNO_CANCELADO)).toHaveLength(2);
  });

  it("tampoco duplica si ya hay otro aviso de corte (un mensaje lleva uno solo)", () => {
    const withBudget = anexarAvisoPresupuesto("Parcial");
    expect(anexarAvisoTurnoIncompleto(withBudget, "cancelado")).toBe(withBudget);
    const withError = anexarAvisoTurnoIncompleto("Parcial", "error");
    expect(anexarAvisoTurnoIncompleto(withError, "cancelado")).toBe(withError);
  });

  it("recorta los espacios finales para no dejar líneas colgando", () => {
    expect(anexarAvisoTurnoIncompleto("Parcial  \n", "cancelado")).toBe(
      `Parcial\n\n${AVISO_TURNO_CANCELADO}`,
    );
  });

  it("los avisos dicen que se puede reintentar y no llevan emojis", () => {
    for (const notice of [AVISO_TURNO_CANCELADO, AVISO_TURNO_ERROR]) {
      expect(notice).toContain("Reintentar");
      expect(notice).toContain("quedó incompleta");
      expect(notice.startsWith("> ")).toBe(true);
      expect(notice).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    }
  });

  it("el cliente los reconoce por marcador (contrato con el web)", () => {

    const withoutAcentos = (text: string) =>
      text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    expect(withoutAcentos(AVISO_TURNO_CANCELADO)).toContain("quedo incompleta");
    expect(withoutAcentos(AVISO_TURNO_CANCELADO)).toContain("cancel");
    expect(withoutAcentos(AVISO_TURNO_ERROR)).toContain("quedo incompleta");
    expect(withoutAcentos(AVISO_TURNO_ERROR)).not.toContain("cancel");
  });

  it("se refleja en el último segmento de texto (lo que renderiza la UI)", () => {
    const segments: SegmentoStream[] = [{ kind: "text", text: "trabajando…" }];
    anexarAvisoTurnoIncompletoSegmento(segments, "cancelado");

    expect(segments).toEqual([
      { kind: "text", text: `trabajando…\n\n${AVISO_TURNO_CANCELADO}` },
    ]);
    anexarAvisoTurnoIncompletoSegmento(segments, "cancelado");
    expect(segments).toHaveLength(1);
  });

  it("si el turno terminó en herramienta añade un segmento de texto nuevo", () => {
    const segments: SegmentoStream[] = [
      { kind: "text", text: "previo" },
      { kind: "tool", id: "tool-a", name: "ssh_execute", input: {}, status: "error" },
    ];
    anexarAvisoTurnoIncompletoSegmento(segments, "error");

    expect(segments).toHaveLength(3);
    expect(segments[2]).toEqual({ kind: "text", text: AVISO_TURNO_ERROR });
    anexarAvisoTurnoIncompletoSegmento(segments, "error");
    expect(segments).toHaveLength(3);
  });

  it("no se confunde con el aviso de presupuesto (son avisos distintos)", () => {
    expect(anexarAvisoTurnoIncompleto("Parcial", "cancelado")).not.toContain(AVISO_PRESUPUESTO);
    expect(anexarAvisoPresupuesto("Parcial")).not.toContain(AVISO_TURNO_CANCELADO);
    expect(anexarAvisoPresupuesto("Parcial")).not.toContain(AVISO_TURNO_ERROR);
  });
});



describe("cerrarSegmentosPendientes al abortar", () => {
  it("cierra la tool en curso como error con el motivo de cancelación", () => {
    const segments: SegmentoStream[] = [
      { kind: "text", text: "voy a tocar el router" },
      {
        kind: "tool",
        id: "tool-a",
        name: "send_command",
        input: { commands: ["conf t"] },
        status: "running",
      },
      {
        kind: "tool",
        id: "tool-b",
        name: "configure_device",
        input: {},
        status: "waiting_approval",
      },
    ];
    const events: Array<{ event: string; data: any }> = [];
    const ejecuciones: ToolExecution[] = [];

    cerrarSegmentosPendientes(
      segments,
      (event, data) => events.push({ event, data }),
      ejecuciones,
      "cancelacion",
    );


    expect(
      segments.filter(
        (segment) =>
          segment.kind === "tool" && (segment.status === "running" || segment.status === "waiting_approval"),
      ),
    ).toHaveLength(0);
    expect(events.map((item) => item.event)).toEqual(["tool_call_result", "tool_call_result"]);

    expect(events[0].data.status).toBe("error");
    expect(events[0].data.output).toContain("[TURNO_CANCELADO]");
    expect(events[0].data.output).not.toContain("[TURNO_FALLIDO]");
    expect(events[1].data.status).toBe("rejected");
    expect(events[1].data.output).toContain("[APROBACION_CANCELADA] El turno se canceló");

    expect(ejecuciones.map((item) => `${item.id}:${item.status}`)).toEqual([
      "tool-a:error",
      "tool-b:rejected",
    ]);
    expect(ejecuciones[0].output).toContain("[TURNO_CANCELADO]");
  });

  it("un corte por error se distingue del corte por cancelación", () => {
    const segments: SegmentoStream[] = [
      { kind: "tool", id: "tool-a", name: "send_command", input: {}, status: "running" },
    ];
    const ejecuciones: ToolExecution[] = [];

    cerrarSegmentosPendientes(segments, () => {}, ejecuciones, "error");

    expect(ejecuciones[0].output).toContain("[TURNO_FALLIDO]");
    expect(ejecuciones[0].status).toBe("error");
  });

  it("sin motivo explícito conserva los textos de siempre (fin de turno)", () => {
    const segments: SegmentoStream[] = [
      { kind: "tool", id: "tool-a", name: "send_command", input: {}, status: "running" },
      { kind: "tool", id: "tool-b", name: "configure_device", input: {}, status: "waiting_approval" },
    ];
    const ejecuciones: ToolExecution[] = [];

    cerrarSegmentosPendientes(segments, () => {}, ejecuciones);

    expect(ejecuciones[0].output).toBe(
      "[TURNO_INTERRUMPIDO] La herramienta no reportó resultado antes de finalizar el turno.",
    );
    expect(ejecuciones[1].output).toBe(
      "[APROBACION_CANCELADA] El turno finalizó sin respuesta de aprobación.",
    );
  });

  it("sigue siendo idempotente con motivo de cancelación", () => {
    const segments: SegmentoStream[] = [
      { kind: "tool", id: "tool-a", name: "send_command", input: {}, status: "running" },
    ];
    const events: Array<{ event: string; data: any }> = [];
    const ejecuciones: ToolExecution[] = [];
    const send = (event: string, data: unknown) => events.push({ event, data });

    cerrarSegmentosPendientes(segments, send, ejecuciones, "cancelacion");
    cerrarSegmentosPendientes(segments, send, ejecuciones, "cancelacion");

    expect(events).toHaveLength(1);
    expect(ejecuciones).toHaveLength(1);
  });
});



const createdUsers: string[] = [];
const createdChatIds: string[] = [];

afterAll(async () => {
  const bearer = await adminBearer();
  for (const id of createdChatIds) {
    await publicApi().delete(`/api/chats/${id}`).set("Authorization", bearer).catch(() => undefined);
  }
  for (const username of createdUsers) await removeTestUser(username);
});

async function userWithSession() {
  const owner = await createTestUser("STAFF");
  createdUsers.push(owner.username);
  const login = await publicApi().post("/api/auth/login").send(owner);
  return (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
}

async function createChat(cookie: string): Promise<string> {
  const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({ title: "Cancelación" });
  createdChatIds.push(created.body.data.id);
  return created.body.data.id;
}

describe("Chats: turno cancelado por el cliente (SSE)", () => {
  
  const PARCIAL_R1 = "Voy a configurar el router R1 con OSPF.";

  it("emite error code 'cancelled', cierra la tool a medias y guarda el texto parcial con el aviso", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie);

    script.current = {
      chunks: [text(PARCIAL_R1), toolCallParcial("tool-1", "send_command")],

      error: new Error("Abort"),
    };

    const cuerpo = await pedirTurn(chatId, cookie, "configura OSPF en R1");
    const events = eventsSse(cuerpo);
    const error = events.find((item) => item.event === "error");

    expect(error).toBeTruthy();
    expect(error!.data.code).toBe("cancelled");

    expect(error!.data.message).toContain("Turno cancelado");


    const result = events.filter((item) => item.event === "tool_call_result");
    const cerrada = result.find((item) => item.data.id === "tool-1");
    expect(cerrada?.data.status).toBe("error");
    expect(cerrada?.data.output).toContain("[TURNO_CANCELADO]");


    const complete = events.find((item) => item.event === "complete");
    expect(complete).toBeTruthy();
    expect(complete!.data.content).toBe(`${PARCIAL_R1}\n\n${AVISO_TURNO_CANCELADO}`);
    const segments = complete!.data.segments as SegmentoStream[];
    expect(segments.filter((item) => item.kind === "text").map((item) => (item as any).text).join("")).toBe(
      `${PARCIAL_R1}${AVISO_TURNO_CANCELADO}`,
    );
    expect(segments.every((item) => item.kind !== "tool" || item.status !== "running")).toBe(true);
  }, 30000);

  it("un turno que termina bien NO lleva el aviso de incompleto", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie);

    script.current = { chunks: [text("Listo: OSPF aplicado y verificado.")] };

    const cuerpo = await pedirTurn(chatId, cookie, "configura OSPF en R2");
    const events = eventsSse(cuerpo);
    const complete = events.find((item) => item.event === "complete");

    expect(events.some((item) => item.event === "error")).toBe(false);
    expect(complete!.data.content).toBe("Listo: OSPF aplicado y verificado.");
    expect(complete!.data.content).not.toContain(AVISO_TURNO_CANCELADO);
    expect(complete!.data.content).not.toContain(AVISO_TURNO_ERROR);
  }, 30000);

  it("un error del agente con texto parcial guarda el texto con el aviso de error", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie);

    script.current = {
      chunks: [text("Empiezo por el router R3")],
      error: new Error("socket hang up"),
    };

    const cuerpo = await pedirTurn(chatId, cookie, "aplica OSPF en R3");
    const events = eventsSse(cuerpo);
    const error = events.find((item) => item.event === "error");


    expect(error!.data.code).toBe("agent_error");
    const complete = events.find((item) => item.event === "complete");
    expect(complete!.data.content).toBe(`Empiezo por el router R3\n\n${AVISO_TURNO_ERROR}`);
  }, 30000);
});

describe("Chats: desconexión real del cliente a mitad del stream", () => {
  let baseUrl = "";

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.once("listening", resolve);
      (server as HttpServer).listen(0);
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if ((server as HttpServer).listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  
  const PARCIAL_R4 = "Configurando el router R4";

  it("el stream termina sin excepción pero el signal está abortado: se marca 'cancelled' y persiste el parcial", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie);



    script.current = { chunks: [text(PARCIAL_R4)], waitAbort: true };

    const cuerpoPost = JSON.stringify({ content: "configura el router R4" });
    let cerradoPorElTest = false;
    await new Promise<void>((resolve) => {
      const peticion = httpRequest(
        `${baseUrl}/api/chats/${chatId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(cuerpoPost),
            Cookie: cookie,
          },
        },
        () => resolve(),
      );
      let recibido = "";
      peticion.on("response", (res) => {
        res.setEncoding("utf8");
        res.on("data", (trozo: string) => {
          recibido += trozo;

          if (!cerradoPorElTest && recibido.includes("event: text_delta")) {
            cerradoPorElTest = true;
            peticion.destroy();
            resolve();
          }
        });
      });
      peticion.on("error", () => resolve());
      peticion.end(cuerpoPost);
      setTimeout(() => {
        cerradoPorElTest = true;
        peticion.destroy();
        resolve();
      }, 10000);
    });

    expect(cerradoPorElTest).toBe(true);


    const mensaje = await waitMessageAssistant(chatId);
    expect(mensaje).toBeTruthy();
    expect(mensaje!.content).toContain(PARCIAL_R4);
    expect(mensaje!.content).toBe(`${PARCIAL_R4}\n\n${AVISO_TURNO_CANCELADO}`);

    const segments = (mensaje!.segments ?? []) as SegmentoStream[];
    expect(
      segments.some((item) => item.kind === "text" && item.text?.includes(AVISO_TURNO_CANCELADO)),
    ).toBe(true);


    const senal = script.senales[script.senales.length - 1];
    expect(senal?.aborted).toBe(true);
  }, 30000);
});
