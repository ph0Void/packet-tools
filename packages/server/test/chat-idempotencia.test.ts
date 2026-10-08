

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AIMessageChunk } from "@langchain/core/messages";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  MENSAJE_ENVIO_DUPLICADO,
  MENSAJE_TURNO_EN_CURSO,
  RegistroTurnosEnCurso,
  cuerpoEnvioRechazado,
  esClientMessageIdValido,
  registrarTurnosEnCurso,
} from "@/api/router/turnoEnCurso";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";




interface ScriptTurn {
  
  chunks: unknown[];
  
  waitMs?: number;
}

const script = vi.hoisted(() => ({
  current: { chunks: [] } as ScriptTurn,
}));

vi.mock("@/agent/deep/turn", () => ({
  createTurnStream: async (args: { signal?: AbortSignal }) => {
    const current = script.actual;
    async function* generador() {
      for (const chunk of current.chunks) yield [chunk, {}];
      
      
      const limit = Date.now() + (current.waitMs ?? 0);
      while (Date.now() < limit && !args.signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    return { stream: generador(), threadId: "hilo-test", deep: false };
  },
  invokeTurn: async () => ({ messages: [], deep: true }),
}));

function text(content: string): AIMessageChunk {
  return new AIMessageChunk({ content });
}



const createdUsers: string[] = [];
const createdChatIds: string[] = [];

afterAll(async () => {
  const bearer = await adminBearer();
  for (const id of createdChatIds) {
    await publicApi()
      .delete(`/api/chats/${id}`)
      .set("Authorization", bearer)
      .catch(() => undefined);
  }
  for (const username of createdUsers) await removeTestUser(username);
});


async function userWithSession() {
  const owner = await createTestUser("USER");
  createdUsers.push(owner.username);
  const login = await publicApi().post("/api/auth/login").send(owner);
  return (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
}

async function createChat(cookie: string, title = "Idempotencia"): Promise<string> {  const created = await publicApi()
    .post("/api/chats")
    .set("Cookie", cookie)
    .send({ title: title });
  createdChatIds.push(created.body.data.id);
  return created.body.data.id;
}

function send(chatId: string, cookie: string, body: Record<string, unknown>) {
  return publicApi().post(`/api/chats/${chatId}/messages`).set("Cookie", cookie).send(body);
}


function messagesUser(chatId: string) {
  return prismaClient.message.findMany({
    where: { chatId, role: "user" },
    orderBy: { createdAt: "asc" },
  });
}


async function waitMessagesUser(chatId: string, n: number, timeoutMs = 5000) {
  const limit = Date.now() + timeoutMs;
  while (Date.now() < limit) {
    const actuales = await messagesUser(chatId);
    if (actuales.length >= n) return actuales;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return messagesUser(chatId);
}


async function pedirTurn(
  chatId: string,
  cookie: string,
  cuerpo: Record<string, unknown>,
): Promise<string> {
  const reply = await send(chatId, cookie, cuerpo)
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



describe("RegistroTurnosEnCurso: un turno por chat", () => {
  it("reserva un turno y lo libera", () => {
    const record = new RegistroTurnosEnCurso();
    expect(record.hayTurnoEnCurso("chat-a")).toBe(false);

    const reserva = record.reservar("chat-a", { clientMessageId: "cmid-1" });
    expect(reserva).toBeTruthy();
    expect(record.hayTurnoEnCurso("chat-a")).toBe(true);
    expect(record.turnoEnCurso("chat-a")?.clientMessageId).toBe("cmid-1");

    reserva!.registrarMensaje("msg-1");
    expect(record.turnoEnCurso("chat-a")?.messageId).toBe("msg-1");

    reserva!.liberar();
    expect(record.hayTurnoEnCurso("chat-a")).toBe(false);
    expect(record.turnoEnCurso("chat-a")).toBeNull();
  });

  it("un segundo envío del mismo chat NO obtiene reserva", () => {
    const record = new RegistroTurnosEnCurso();
    const first = record.reservar("chat-a", { clientMessageId: "cmid-1" });
    const second = record.reservar("chat-a", { clientMessageId: "cmid-2" });
    expect(first).toBeTruthy();
    expect(second).toBeNull();

    expect(record.turnoEnCurso("chat-a")?.clientMessageId).toBe("cmid-1");
  });

  it("chats distintos no se bloquean entre sí", () => {
    const record = new RegistroTurnosEnCurso();
    expect(record.reservar("chat-a")).toBeTruthy();
    expect(record.reservar("chat-b")).toBeTruthy();
    expect(record.chatsConTurno.sort()).toEqual(["chat-a", "chat-b"]);
  });

  it("liberar es idempotente y una reserva vieja no libera un turno posterior", () => {
    const record = new RegistroTurnosEnCurso();
    const first = record.reservar("chat-a")!;
    first.liberar();
    first.liberar();
    const second = record.reservar("chat-a", { clientMessageId: "cmid-2" })!;

    first.liberar();
    expect(record.hayTurnoEnCurso("chat-a")).toBe(true);
    expect(record.turnoEnCurso("chat-a")?.clientMessageId).toBe("cmid-2");
    second.liberar();
    expect(record.hayTurnoEnCurso("chat-a")).toBe(false);
  });
});

describe("cuerpo del 409 de envío", () => {
  it("DUPLICADO lleva el id y el mensaje ya persistidos", () => {
    const cuerpo = cuerpoEnvioRechazado("DUPLICADO", { id: "msg-7", message: { id: "msg-7" } });
    expect(cuerpo.success).toBe(false);
    expect(cuerpo.code).toBe("DUPLICADO");
    expect(cuerpo.message).toBe(MENSAJE_ENVIO_DUPLICADO);
    expect(cuerpo.data?.messageId).toBe("msg-7");
    expect(cuerpo.data?.message).toEqual({ id: "msg-7" });
  });

  it("TURNO_EN_CURSO no lleva datos (no hay mensaje que reconciliar)", () => {
    const cuerpo = cuerpoEnvioRechazado("TURNO_EN_CURSO");
    expect(cuerpo.code).toBe("TURNO_EN_CURSO");
    expect(cuerpo.message).toBe(MENSAJE_TURNO_EN_CURSO);
    expect(cuerpo.data).toBeNull();
  });
});

describe("forma del clientMessageId", () => {
  it("admite UUID y aleatorios cortos, rechaza basura", () => {
    expect(esClientMessageIdValido("3f1b7a52-9c1e-4a6d-8f0b-2c9e5a7d1e44")).toBe(true);
    expect(esClientMessageIdValido("cm-1712345678901-abc123")).toBe(true);
    expect(esClientMessageIdValido("")).toBe(false);
    expect(esClientMessageIdValido("a".repeat(65))).toBe(false);
    expect(esClientMessageIdValido("hola mundo")).toBe(false);
    expect(esClientMessageIdValido("'; DROP TABLE Message;--")).toBe(false);
    expect(esClientMessageIdValido(42)).toBe(false);
  });
});



describe("POST /:id/messages: idempotencia con clientMessageId", () => {
  it("(a) el mismo clientMessageId dos veces → 409 DUPLICADO y UN solo mensaje de usuario", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Duplicado");
    const clientMessageId = "idempotencia-a-1";

    const first = await send(chatId, cookie, {
      content: "configura OSPF en R1",
      stream: false,
      clientMessageId,
    });
    expect(first.status).toBe(201);


    const second = await send(chatId, cookie, {
      content: "configura OSPF en R1",
      stream: false,
      clientMessageId,
    });
    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.code).toBe("DUPLICADO");

    expect(second.body.data.messageId).toBe(first.body.data.id);
    expect(second.body.data.message?.content).toBe("configura OSPF en R1");

    expect(typeof second.body.message).toBe("string");
    expect(second.body.message.length).toBeGreaterThan(0);


    const users = await messagesUser(chatId);
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(first.body.data.id);
    expect(users[0].clientMessageId).toBe(clientMessageId);
  });

  it("(a-bis) un clientMessageId ya usado en OTRO chat no bloquea este", async () => {
    const cookie = await userWithSession();
    const chatA = await createChat(cookie, "Chat A");
    const chatB = await createChat(cookie, "Chat B");
    const clientMessageId = "mismo-id-en-dos-chats";

    const first = await send(chatA, cookie, { content: "hola", stream: false, clientMessageId });
    const second = await send(chatB, cookie, { content: "hola", stream: false, clientMessageId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
  });

  it("(b) clientMessageId distintos → ambos envíos pasan", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Distintos");

    const first = await send(chatId, cookie, { content: "ping", stream: false, clientMessageId: "id-1" });
    const second = await send(chatId, cookie, { content: "pong", stream: false, clientMessageId: "id-2" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);

    const users = await messagesUser(chatId);
    expect(users).toHaveLength(2);
    expect(users.map((m) => m.content)).toEqual(["ping", "pong"]);
  });

  it("(c) sin clientMessageId el comportamiento no cambia (201 y mensaje persistido)", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Sin identificador");

    const first = await send(chatId, cookie, { content: "hola sin id", stream: false });
    const second = await send(chatId, cookie, { content: "otra sin id", stream: false });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const users = await messagesUser(chatId);
    expect(users).toHaveLength(2);
    expect(users.every((m) => m.clientMessageId === null)).toBe(true);
  });

  it("rechaza un clientMessageId con forma inválida antes de crear nada (400)", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Forma inválida");

    const invalido = await send(chatId, cookie, {
      content: "hola",
      stream: false,
      clientMessageId: "no es un id válido",
    });
    expect(invalido.status).toBe(400);
    expect(await messagesUser(chatId)).toHaveLength(0);

    const demasiadoLong = await send(chatId, cookie, {
      content: "hola",
      stream: false,
      clientMessageId: "x".repeat(65),
    });
    expect(demasiadoLong.status).toBe(400);
    expect(await messagesUser(chatId)).toHaveLength(0);
  });

  it("el índice único de la BD es la red de seguridad: dos INSERT con el mismo id chocan (P2002)", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Indice único");
    const clientMessageId = "indice-unico-1";

    const created = await prismaClient.message.create({
      data: { chatId, role: "user", content: "primero", clientMessageId },
    });

    await expect(
      prismaClient.message.create({
        data: { chatId, role: "user", content: "segundo", clientMessageId },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await messagesUser(chatId)).toHaveLength(1);


    await prismaClient.message.create({ data: { chatId, role: "user", content: "sin id 1" } });
    await prismaClient.message.create({ data: { chatId, role: "user", content: "sin id 2" } });
    expect(await messagesUser(chatId)).toHaveLength(3);
    expect(created.clientMessageId).toBe(clientMessageId);
  });

  it("un reenvío con SSE también es 409 DUPLICADO y no abre un segundo turno", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Duplicado con SSE");
    script.actual = { chunks: [text("Hecho.")] };

    const clientMessageId = "idempotencia-sse-1";
    const cuerpo = await pedirTurn(chatId, cookie, { content: "muestra la consola", clientMessageId });
    expect(cuerpo).toContain("event: complete");

    const second = await send(chatId, cookie, { content: "muestra la consola", clientMessageId });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("DUPLICADO");

    const users = await messagesUser(chatId);
    const asistentes = await prismaClient.message.findMany({ where: { chatId, role: "assistant" } });
    expect(users).toHaveLength(1);
    expect(asistentes).toHaveLength(1);
  });
});

describe("POST /:id/messages: turno en curso", () => {
  afterEach(() => {
    script.actual = { chunks: [] };
  });

  it("(d) dos envíos con el turno abierto → el segundo es 409 TURNO_EN_CURSO y no crea mensaje", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Simultáneos");
    script.actual = { chunks: [text("Turno largo...")], waitMs: 1500 };


    const first = pedirTurn(chatId, cookie, { content: "configura R1" });
    await waitMessagesUser(chatId, 1);
    expect(registrarTurnosEnCurso.hayTurnoEnCurso(chatId)).toBe(true);


    const second = await send(chatId, cookie, { content: "y ahora R2" });
    expect(second.status).toBe(409);
    expect(second.body.success).toBe(false);
    expect(second.body.code).toBe("TURNO_EN_CURSO");
    expect(typeof second.body.message).toBe("string");
    expect(second.body.message.length).toBeGreaterThan(0);


    expect(await messagesUser(chatId)).toHaveLength(1);

    const cuerpo = await first;
    expect(cuerpo).toContain("event: complete");
    const asistentes = await prismaClient.message.findMany({ where: { chatId, role: "assistant" } });
    expect(asistentes).toHaveLength(1);


    expect(registrarTurnosEnCurso.hayTurnoEnCurso(chatId)).toBe(false);
    const third = await send(chatId, cookie, { content: "y ahora R2", stream: false });
    expect(third.status).toBe(201);
  }, 30000);

  it("un fallo del turno no deja el chat bloqueado", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Turno con error");

    script.actual = { chunks: [], waitMs: 200 };

    const cuerpo = await pedirTurn(chatId, cookie, { content: "hola" });
    expect(cuerpo).toContain("event: complete");
    expect(registrarTurnosEnCurso.hayTurnoEnCurso(chatId)).toBe(false);

    const next = await send(chatId, cookie, { content: "otra vez", stream: false });
    expect(next.status).toBe(201);
  }, 30000);

  it("un turno en curso de un chat no bloquea los envíos de otro chat", async () => {
    const cookie = await userWithSession();
    const chatA = await createChat(cookie, "Chat con turno");
    const chatB = await createChat(cookie, "Chat libre");
    script.actual = { chunks: [text("Trabajando...")], waitMs: 1200 };

    const enCurso = pedirTurn(chatA, cookie, { content: "arranca" });
    await waitMessagesUser(chatA, 1);

    const other = await send(chatB, cookie, { content: "no me bloquees", stream: false });
    expect(other.status).toBe(201);

    await enCurso;
  }, 30000);
});
