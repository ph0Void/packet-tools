

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { AIMessageChunk } from "@langchain/core/messages";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  registrarTurnosEnCurso,
} from "@/api/router/turnoEnCurso";
import { anexarAvisoTurnoIncompleto } from "@/api/router/continuation";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";


const turns = vi.hoisted(() => [] as Array<{ chatId: string; messageId: string }>);


const script = vi.hoisted(() => ({
  chunks: [] as unknown[],
  waitMs: 0,
}));

vi.mock("@/agent/deep/turn", () => ({
  createTurnStream: async (args: {
    chatId: string;
    messageId: string;
    signal?: AbortSignal;
  }) => {
    turns.push({ chatId: args.chatId, messageId: args.messageId });
    async function* generador() {
      for (const chunk of script.chunks) yield [chunk, {}];
      const limit = Date.now() + script.waitMs;
      while (Date.now() < limit && !args.signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    
    return { stream: generador(), threadId: `${args.chatId}:${args.messageId}`, deep: true };
  },
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

afterEach(() => {
  turns.length = 0;
  script.chunks = [];
  script.waitMs = 0;
});


async function userWithSession() {
  const owner = await createTestUser("USER");
  createdUsers.push(owner.username);
  const login = await publicApi().post("/api/auth/login").send(owner);
  return (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
}

async function createChat(cookie: string, title = "Reintento"): Promise<string> {
  const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({ title: title });
  createdChatIds.push(created.body.data.id);
  return created.body.data.id;
}


async function pedirTurn(
  route: string,
  cookie: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const reply = await publicApi()
    .post(route)
    .set("Cookie", cookie)
    .send(body)
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


function messagesOf(chatId: string) {
  return prismaClient.message.findMany({ where: { chatId }, orderBy: { createdAt: "asc" } });
}


function messagesUser(chatId: string) {
  return prismaClient.message.findMany({
    where: { chatId, role: "user" },
    orderBy: { createdAt: "asc" },
  });
}

function reintentar(chatId: string, messageId: string, cookie: string) {
  return publicApi().post(`/api/chats/${chatId}/messages/${messageId}/retry`).set("Cookie", cookie);
}



describe("POST /:id/messages/:messageId/retry (D4/V22)", () => {
  it("(a) reintenta sobre el MISMO mensaje de usuario y no duplica el historial", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Reintento simple");


    const original = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ content: "configura OSPF en R1", stream: false });
    expect(original.status).toBe(201);
    const messageId = original.body.data.id as string;

    script.chunks = [text("OSPF configurado." )];
    turns.length = 0;
    const cuerpo = await pedirTurn(`/api/chats/${chatId}/messages/${messageId}/retry`, cookie);
    expect(cuerpo).toContain("event: complete");
    expect(cuerpo).toContain("event: text_delta");

    expect(cuerpo).not.toContain("event: user_message");


    expect(turns).toHaveLength(1);
    expect(turns[0]).toEqual({ chatId, messageId });

    const todos = await messagesOf(chatId);
    const users = todos.filter((m) => m.role === "user");
    const asistentes = todos.filter((m) => m.role === "assistant");

    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(messageId);

    expect(asistentes).toHaveLength(1);
    expect(asistentes[0].content).toContain("OSPF configurado.");


    expect(registrarTurnosEnCurso.hayTurnoEnCurso(chatId)).toBe(false);
  }, 30000);

  it("(b) 409 TURNO_EN_CURSO si ya hay un turno vivo en el chat", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Reintento ocupado");
    const original = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ content: "arranca el turno largo", stream: false });
    const messageId = original.body.data.id as string;


    script.chunks = [text("Trabajando...")];
    script.waitMs = 1500;
    const enCurso = pedirTurn(`/api/chats/${chatId}/messages`, cookie, {
      content: "otro mensaje para ocupar el chat",
    });

    const limit = Date.now() + 5000;
    while (!registrarTurnosEnCurso.hayTurnoEnCurso(chatId) && Date.now() < limit) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(registrarTurnosEnCurso.hayTurnoEnCurso(chatId)).toBe(true);

    const second = await reintentar(chatId, messageId, cookie);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("TURNO_EN_CURSO");
    expect(typeof second.body.message).toBe("string");

    await enCurso;
    script.waitMs = 0;
  }, 30000);

  it("(c) 404 si el chat es de otro usuario", async () => {
    const owner = await userWithSession();
    const chatId = await createChat(owner, "Chat ajeno");
    const original = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", owner)
      .send({ content: "privado", stream: false });
    const messageId = original.body.data.id as string;

    const intruder = await userWithSession();
    const reply = await reintentar(chatId, messageId, intruder);
    expect(reply.status).toBe(404);

    expect(await messagesUser(chatId)).toHaveLength(1);
  }, 30000);

  it("(c-bis) 404 si el mensaje no pertenece al chat", async () => {
    const cookie = await userWithSession();
    const chatA = await createChat(cookie, "Chat A");
    const chatB = await createChat(cookie, "Chat B");
    const enA = await publicApi()
      .post(`/api/chats/${chatA}/messages`)
      .set("Cookie", cookie)
      .send({ content: "mensaje en A", stream: false });
    const messageId = enA.body.data.id as string;


    const cruzado = await reintentar(chatB, messageId, cookie);
    expect(cruzado.status).toBe(404);
    expect(turns).toHaveLength(0);
  }, 30000);

  it("(c-ter) 404 si el mensaje es del asistente (no de usuario)", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Mensaje assistant");
    script.chunks = [text("Respuesta del asistente.")];
    await pedirTurn(`/api/chats/${chatId}/messages`, cookie, { content: "hola" });
    const asistente = (await messagesOf(chatId)).find((m) => m.role === "assistant");
    expect(asistente).toBeTruthy();


    turns.length = 0;
    const reply = await reintentar(chatId, asistente!.id, cookie);
    expect(reply.status).toBe(404);
    expect(turns).toHaveLength(0);
  }, 30000);

  it("(d) reintento de algo ya completado → 409 YA_REINTENTADO con el id del assistant", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Ya reintentado");
    const original = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ content: "solo una vez", stream: false });
    const messageId = original.body.data.id as string;


    script.chunks = [text("Hecho.")];
    turns.length = 0;
    await pedirTurn(`/api/chats/${chatId}/messages/${messageId}/retry`, cookie);
    expect(turns).toHaveLength(1);
    const primerAssistant = (await messagesOf(chatId)).find((m) => m.role === "assistant")!;
    expect(primerAssistant.id).toBeTruthy();
    expect(primerAssistant.content).toContain("Hecho.");


    turns.length = 0;
    const second = await reintentar(chatId, messageId, cookie);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("YA_REINTENTADO");

    expect(second.body.data.assistantMessageId).toBe(primerAssistant.id);
    expect(typeof second.body.message).toBe("string");

    expect(turns).toHaveLength(0);
    expect(await messagesOf(chatId)).toHaveLength(2);
  }, 30000);

  it("(e) un turno CORTADO sí es reintentable (el reintento es justo para eso)", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Turno cortado");


    const original = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ content: "configura BGP", stream: false });
    const messageId = original.body.data.id as string;
    await prismaClient.message.create({
      data: {
        chatId,
        role: "assistant",
        content: anexarAvisoTurnoIncompleto("Me quedé a medias", "cancelado"),
      },
    });

    turns.length = 0;
    script.chunks = [text("BGP configurado." )];
    const cuerpo = await pedirTurn(`/api/chats/${chatId}/messages/${messageId}/retry`, cookie);
    expect(cuerpo).toContain("event: complete");
    expect(turns).toHaveLength(1);

    const todos = await messagesOf(chatId);
    expect(todos.filter((m) => m.role === "user")).toHaveLength(1);

    const asistentes = todos.filter((m) => m.role === "assistant");
    expect(asistentes).toHaveLength(2);
    expect(asistentes[1].content).toContain("BGP configurado.");

    const third = await reintentar(chatId, messageId, cookie);
    expect(third.status).toBe(409);
    expect(third.body.code).toBe("YA_REINTENTADO");
  }, 30000);

  it("(f) un turno interrumpido NO cuenta como respuesta completa (el aviso manda)", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Aviso de corte");
    const original = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ content: "muestra la consola", stream: false });
    const messageId = original.body.data.id as string;

    await prismaClient.message.create({
      data: {
        chatId,
        role: "assistant",
        content: anexarAvisoTurnoIncompleto("Salida parcial…", "error"),
      },
    });

    turns.length = 0;
    script.chunks = [text("Ahora sí." )];
    await pedirTurn(`/api/chats/${chatId}/messages/${messageId}/retry`, cookie);
    expect(turns).toHaveLength(1);
  }, 30000);

  it("(g) un error del turno no deja el chat bloqueado para reintentar", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Reintento tras error");
    const original = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ content: "algo que se corta", stream: false });
    const messageId = original.body.data.id as string;


    script.chunks = [];
    turns.length = 0;
    const cuerpo = await pedirTurn(`/api/chats/${chatId}/messages/${messageId}/retry`, cookie);
    expect(cuerpo).toContain("event: complete");
    expect(registrarTurnosEnCurso.hayTurnoEnCurso(chatId)).toBe(false);
  }, 30000);
});
