

import { afterAll, describe, expect, it } from "vitest";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  ErrorPaginacion,
  LIMIT_MAXIMO,
  LIMIT_POR_DEFECTO,
  ORDEN_CHATS,
  ORDEN_MENSAJES,
  construirMetaPaginacion,
  parsearPaginacion,
  takeDePaginacion,
  whereDeCursor,
} from "@/api/router/paginacion";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";



describe("paginacion: parseo de parámetros", () => {
  it("sin parámetros no pagina (compatibilidad con los clientes antiguos)", () => {
    const p = parsearPaginacion({});
    expect(p.limit).toBeNull();
    expect(p.cursor).toBeNull();
    expect(p.skip).toBe(0);
    expect(p.paginado).toBe(false);
    
    expect(takeDePaginacion(p)).toBeUndefined();
  });

  it("limit sin cursor toma la primera página con el default", () => {
    const p = parsearPaginacion({ limit: "10" });
    expect(p.limit).toBe(10);
    expect(p.paginado).toBe(true);
    expect(takeDePaginacion(p)).toBe(11); 
  });

  it("page calcula el offset y se lleva su limit por defecto", () => {
    const p = parsearPaginacion({ page: "3" });
    expect(p.limit).toBe(LIMIT_POR_DEFECTO);
    expect(p.skip).toBe(2 * LIMIT_POR_DEFECTO);
  });

  it("page + limit se combinan", () => {
    const p = parsearPaginacion({ page: "2", limit: "5" });
    expect(p.limit).toBe(5);
    expect(p.skip).toBe(5);
  });

  it("rechaza limit fuera de rango o no entero (400)", () => {
    for (const limit of ["0", "-1", "abc", "1.5", " ", String(LIMIT_MAXIMO + 1)]) {
      expect(() => parsearPaginacion({ limit }), limit).toThrow(ErrorPaginacion);
    }
  });

  it("rechaza page < 1 y page no entera", () => {
    expect(() => parsearPaginacion({ page: "0" })).toThrow(ErrorPaginacion);
    expect(() => parsearPaginacion({ page: "abc" })).toThrow(ErrorPaginacion);
  });

  it("cursor y page a la vez es 400 (son dos paginaciones distintas)", () => {
    expect(() => parsearPaginacion({ cursor: "abc", page: "2" })).toThrow(ErrorPaginacion);
  });

  it("un cursor vacío se ignora en vez de fallar", () => {
    const p = parsearPaginacion({ cursor: "", limit: "5" });
    expect(p.cursor).toBeNull();
    expect(p.limit).toBe(5);
  });

  it("toma el primer valor si el parámetro viene repetido", () => {
    expect(parsearPaginacion({ limit: ["5", "9"] }).limit).toBe(5);
  });
});

describe("paginacion: filtro keyset", () => {
  it("sin cursor no añade filtro", () => {
    expect(whereDeCursor(ORDEN_MENSAJES, null, null, { chatId: "c" })).toBeUndefined();
    
    expect(whereDeCursor(ORDEN_MENSAJES, "x", null, { chatId: "c" })).toBeUndefined();
  });

  it("en orden ASCENDENTE: fecha > X OR (fecha = X AND id > cursor)", () => {
    const marker = new Date("2026-10-05T10:00:00Z");
    const where = whereDeCursor(ORDEN_MENSAJES, "msg-9", { createdAt: marker }, { chatId: "c" });
    expect(where).toBeDefined();
    const or = (where as any).AND[1].OR;
    expect(or[0]).toEqual({ createdAt: { gt: marker } });
    expect(or[1]).toEqual({ createdAt: marker, id: { gt: "msg-9" } });
    
    expect((where as any).AND[0]).toEqual({ chatId: "c" });
  });

  it("en orden DESCENDENTE usa `lt`, no `gt` (si no, se pagina en bucle)", () => {
    
    
    const marker = new Date("2026-10-05T10:00:00Z");
    const where = whereDeCursor(ORDEN_CHATS, "chat-3", { updatedAt: marker }, { userId: "u" });
    const or = (where as any).AND[1].OR;
    expect(or[0]).toEqual({ updatedAt: { lt: marker } });
    expect(or[1]).toEqual({ updatedAt: marker, id: { lt: "chat-3" } });
    expect((where as any).AND[0]).toEqual({ userId: "u" });
  });

  it("los dos listados declaran sentidos opuestos (fuente única)", () => {
    expect(ORDEN_CHATS).toEqual({ column: "updatedAt", sentido: "desc" });
    expect(ORDEN_MENSAJES).toEqual({ column: "createdAt", sentido: "asc" });
  });
});

describe("paginacion: construcción de la meta y recorte de la fila extra", () => {
  const ids = ["a", "b", "c", "d"];

  it("sin paginación devuelve todo y no hay cursor", () => {
    const { filas, meta } = construirMetaPaginacion(
      ids.map((id) => ({ id })),
      parsearPaginacion({}),
    );
    expect(filas).toHaveLength(4);
    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeNull();
  });

  it("recorta la fila extra y la convierte en cursor", () => {
    
    const { filas, meta } = construirMetaPaginacion(
      ids.map((id) => ({ id })),
      parsearPaginacion({ limit: "3" }),
    );
    expect(filas.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(meta.hasMore).toBe(true);
    expect(meta.nextCursor).toBe("c");
    expect(meta.count).toBe(3);
    expect(meta.limit).toBe(3);
  });

  it("página exacta (sin fila extra) no inventa que hay más", () => {
    const { filas, meta } = construirMetaPaginacion(
      ["a", "b", "c"].map((id) => ({ id })),
      parsearPaginacion({ limit: "3" }),
    );
    expect(filas).toHaveLength(3);
    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeNull();
  });

  it("página vacía: sin filas, sin cursor y sin bucle infinito", () => {
    const { filas, meta } = construirMetaPaginacion([], parsearPaginacion({ limit: "10" }));
    expect(filas).toHaveLength(0);
    expect(meta.hasMore).toBe(false);
    expect(meta.nextCursor).toBeNull();
  });
});



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


async function createChatsWithMessages(cookie: string, n: number, prefix: string): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const created = await publicApi()
      .post("/api/chats")
      .set("Cookie", cookie)
      .send({ title: `${prefix} ${i}` });
    ids.push(created.body.data.id);
    createdChatIds.push(created.body.data.id);
    await publicApi()
      .post(`/api/chats/${created.body.data.id}/messages`)
      .set("Cookie", cookie)
      .send({ content: `mensaje ${i}`, stream: false });
  }
  return ids;
}

describe("GET /api/chats: paginación y resumen", () => {
  it("devuelve el RESUMEN del chat (sin mensajes) con contadores", async () => {
    const cookie = await userWithSession();
    const [chatId] = await createChatsWithMessages(cookie, 1, "Resumen");

    const list = await publicApi().get("/api/chats").set("Cookie", cookie);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    const chat = list.body.data.find((c: any) => c.id === chatId);
    expect(chat).toBeTruthy();

    expect(chat.messages).toBeUndefined();

    expect(chat.title).toBe("Resumen 0");
    expect(chat.modelProviderId).toBeNull();
    expect(chat.messageCount).toBe(1);
    expect(chat.attachmentCount).toBe(0);

    expect(list.body.meta).toBeTruthy();
    expect(list.body.meta.hasMore).toBe(false);
  });

  it("attachmentCount del resumen cuenta los adjuntos reales del chat", async () => {
    const cookie = await userWithSession();
    const [chatId] = await createChatsWithMessages(cookie, 1, "Con adjunto");

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const sent = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({
        content: "con captura",
        stream: false,
        attachments: [
          { fileName: "captura.png", fileType: "IMAGE", fileUrl: `data:image/png;base64,${png.toString("base64")}` },
        ],
      });
    expect(sent.status).toBe(201);

    const list = await publicApi().get("/api/chats").set("Cookie", cookie);
    const chat = list.body.data.find((c: any) => c.id === chatId);
    expect(chat.messageCount).toBe(2);
    expect(chat.attachmentCount).toBe(1);

    expect(chat.messages).toBeUndefined();
  }, 30000);

  it("?include=messages recupera el historial (compatibilidad)", async () => {
    const cookie = await userWithSession();
    const [chatId] = await createChatsWithMessages(cookie, 1, "Con mensajes");

    const list = await publicApi()
      .get("/api/chats?include=messages")
      .set("Cookie", cookie);
    const chat = list.body.data.find((c: any) => c.id === chatId);
    expect(Array.isArray(chat.messages)).toBe(true);
    expect(chat.messages[0].content).toBe("mensaje 0");
  });

  it("limit pagina y meta encadena las páginas con el cursor", async () => {
    const cookie = await userWithSession();
    await createChatsWithMessages(cookie, 5, "Paginado");

    const first = await publicApi().get("/api/chats?limit=2").set("Cookie", cookie);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.meta.hasMore).toBe(true);
    expect(first.body.meta.nextCursor).toBeTruthy();
    expect(first.body.meta.limit).toBe(2);

    const second = await publicApi()
      .get(`/api/chats?limit=2&cursor=${encodeURIComponent(first.body.meta.nextCursor)}`)
      .set("Cookie", cookie);
    expect(second.body.data).toHaveLength(2);

    const ids1 = first.body.data.map((c: any) => c.id);
    const ids2 = second.body.data.map((c: any) => c.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it("recorrer con el cursor devuelve todos los chats sin repetir ninguno", async () => {
    const cookie = await userWithSession();
    await createChatsWithMessages(cookie, 5, "Recorrido");

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url: string = cursor
        ? `/api/chats?limit=2&cursor=${encodeURIComponent(cursor)}`
        : "/api/chats?limit=2";
      const res = await publicApi().get(url).set("Cookie", cookie);
      seen.push(...res.body.data.map((c: any) => c.id));
      if (!res.body.meta.hasMore) break;
      cursor = res.body.meta.nextCursor;
    }
    const todos = (await publicApi().get("/api/chats").set("Cookie", cookie)).body.data.map(
      (c: any) => c.id,
    );
    expect(seen.sort()).toEqual(todos.sort());
    expect(new Set(seen).size).toBe(seen.length);
  }, 60000);

  it("page/limit también funciona (offset)", async () => {
    const cookie = await userWithSession();
    await createChatsWithMessages(cookie, 3, "Offset");
    const uno = await publicApi().get("/api/chats?limit=1&page=1").set("Cookie", cookie);
    const dos = await publicApi().get("/api/chats?limit=1&page=2").set("Cookie", cookie);
    expect(uno.body.data).toHaveLength(1);
    expect(dos.body.data).toHaveLength(1);
    expect(uno.body.data[0].id).not.toBe(dos.body.data[0].id);
  }, 60000);

  it("limit inválido es 400 con mensaje legible", async () => {
    const cookie = await userWithSession();
    const malo = await publicApi().get("/api/chats?limit=abc").set("Cookie", cookie);
    expect(malo.status).toBe(400);
    expect(typeof malo.body.message).toBe("string");
  });

  it("un cursor que ya no existe sirve la primera página (no rompe)", async () => {
    const cookie = await userWithSession();
    await createChatsWithMessages(cookie, 1, "Cursor muerto");
    const reply = await publicApi()
      .get(`/api/chats?limit=5&cursor=${encodeURIComponent("no-existe-xyz")}`)
      .set("Cookie", cookie);
    expect(reply.status).toBe(200);
    expect(reply.body.data.length).toBeGreaterThan(0);
  });
});

describe("GET /api/chats/:id/messages: paginación", () => {
  it("sin parámetros devuelve todos los mensajes del chat", async () => {
    const cookie = await userWithSession();
    const [chatId] = await createChatsWithMessages(cookie, 1, "Historial");
    await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ content: "segundo", stream: false });
    await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({ content: "tercero", stream: false });

    const res = await publicApi().get(`/api/chats/${chatId}/messages`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.map((m: any) => m.content)).toEqual([
      "mensaje 0",
      "segundo",
      "tercero",
    ]);
  });

  it("limit + cursor recorren el historial en orden y sin repeticiones", async () => {
    const cookie = await userWithSession();
    const [chatId] = await createChatsWithMessages(cookie, 1, "Historial largo");
    for (let i = 0; i < 4; i += 1) {
      await publicApi()
        .post(`/api/chats/${chatId}/messages`)
        .set("Cookie", cookie)
        .send({ content: `extra ${i}`, stream: false });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url: string = cursor
        ? `/api/chats/${chatId}/messages?limit=2&cursor=${encodeURIComponent(cursor)}`
        : `/api/chats/${chatId}/messages?limit=2`;
      const res = await publicApi().get(url).set("Cookie", cookie);
      expect(res.status).toBe(200);
      seen.push(...res.body.data.map((m: any) => m.id));
      if (!res.body.meta.hasMore) break;
      cursor = res.body.meta.nextCursor;
    }
    const todos = (await publicApi().get(`/api/chats/${chatId}/messages`).set("Cookie", cookie)).body.data;
    expect(seen).toHaveLength(todos.length);
    expect(seen.sort()).toEqual(todos.map((m: any) => m.id).sort());
  }, 60000);

  it("un chat ajeno sigue dando 404 con paginación", async () => {
    const owner = await userWithSession();
    const [chatId] = await createChatsWithMessages(owner, 1, "Privado");
    const intruder = await userWithSession();
    const res = await publicApi()
      .get(`/api/chats/${chatId}/messages?limit=1`)
      .set("Cookie", intruder);
    expect(res.status).toBe(404);
  });

  it("limit inválido es 400", async () => {
    const cookie = await userWithSession();
    const [chatId] = await createChatsWithMessages(cookie, 1, "Límite");
    const res = await publicApi()
      .get(`/api/chats/${chatId}/messages?limit=-5`)
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });
});

describe("índices de persistencia (V26a)", () => {
  it("los índices de Chat.userId, Message.chatId y Attachment.messageId existen", async () => {

    const indexes = await prismaClient.$queryRawUnsafe<Array<{ name: string }>>(
      "SELECT name FROM sqlite_master WHERE type='index'",
    );
    const names = indexes.map((i) => i.name);
    expect(names).toContain("Chat_userId_idx");
    expect(names).toContain("Message_chatId_idx");
    expect(names).toContain("Attachment_messageId_idx");
    expect(names).toContain("Attachment_userId_idx");
  });

  it("las columnas de metadata del adjunto existen y son nullable", async () => {

    const columns = await prismaClient.$queryRawUnsafe<Array<{ name: string; notnull: bigint }>>(
      "PRAGMA table_info('Attachment')",
    );
    const byName = new Map(columns.map((c) => [c.name, c]));
    for (const name of ["storagePath", "sha256", "sizeBytes", "userId"]) {
      expect(byName.has(name), name).toBe(true);

      expect(Number(byName.get(name)!.notnull), name).toBe(0);
    }
  });

  it("no hay violaciones de clave foránea tras las migraciones", async () => {
    const violaciones = await prismaClient.$queryRawUnsafe("PRAGMA foreign_key_check");
    expect(violaciones).toHaveLength(0);
  });
});
