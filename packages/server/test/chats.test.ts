import { afterAll, describe, expect, it } from "vitest";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";

const createdUsers: string[] = [];
const createdChatIds: string[] = [];
afterAll(async () => {
  const bearer = await adminBearer();
  for (const id of createdChatIds) await publicApi().delete(`/api/chats/${id}`).set("Authorization", bearer).catch(() => undefined);
  for (const username of createdUsers) await removeTestUser(username);
});

describe("Chats /api/chats", () => {
  it("crea un chat, lista mensajes y USER no puede eliminarlo (solo ADMIN/STAFF)", async () => {
    const owner = await createTestUser("USER");
    createdUsers.push(owner.username);
    const ownerLogin = await publicApi().post("/api/auth/login").send(owner);
    const ownerCookie = (ownerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const created = await publicApi().post("/api/chats").set("Cookie", ownerCookie).send({ title: "Chat de prueba" });
    expect(created.status).toBe(201);
    const chatId = created.body.data.id;
    createdChatIds.push(chatId);

    const list = await publicApi().get("/api/chats").set("Cookie", ownerCookie);
    expect(list.status).toBe(200);
    expect((list.body.data ?? []).some((chat: any) => chat.id === chatId)).toBe(true);

    const messages = await publicApi().get(`/api/chats/${chatId}/messages`).set("Cookie", ownerCookie);
    expect(messages.status).toBe(200);
    expect(Array.isArray(messages.body.data)).toBe(true);


    const forbidden = await publicApi().delete(`/api/chats/${chatId}`).set("Cookie", ownerCookie);
    expect(forbidden.status).toBe(403);


    const stranger = await createTestUser("USER");
    createdUsers.push(stranger.username);
    const strangerLogin = await publicApi().post("/api/auth/login").send(stranger);
    const strangerCookie = (strangerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const foreignMessages = await publicApi().get(`/api/chats/${chatId}/messages`).set("Cookie", strangerCookie);
    expect(foreignMessages.status).toBe(404);
  });

  it("guarda un mensaje con stream:false sin invocar al LLM", async () => {
    const owner = await createTestUser("USER");
    createdUsers.push(owner.username);
    const ownerLogin = await publicApi().post("/api/auth/login").send(owner);
    const ownerCookie = (ownerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const created = await publicApi().post("/api/chats").set("Cookie", ownerCookie).send({ title: "Chat stream false" });
    expect(created.status).toBe(201);
    const chatId = created.body.data.id;
    createdChatIds.push(chatId);

    const saved = await publicApi().post(`/api/chats/${chatId}/messages`).set("Cookie", ownerCookie).send({ content: "Hola sin streaming", stream: false });
    expect(saved.status).toBe(201);
    expect(saved.body.data.role).toBe("user");
    expect(saved.body.data.content).toBe("Hola sin streaming");
  });

  it("ADMIN puede eliminar cualquier chat", async () => {
    const owner = await createTestUser("USER");
    createdUsers.push(owner.username);
    const ownerLogin = await publicApi().post("/api/auth/login").send(owner);
    const ownerCookie = (ownerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const created = await publicApi().post("/api/chats").set("Cookie", ownerCookie).send({});
    const chatId = created.body.data.id;

    const deleted = await publicApi().delete(`/api/chats/${chatId}`).set("Authorization", await adminBearer());
    expect(deleted.status).toBe(200);
    createdChatIds.splice(createdChatIds.indexOf(chatId), 1);
  });
});
