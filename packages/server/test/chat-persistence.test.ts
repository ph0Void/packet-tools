import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";
import { prismaClient } from "@/prisma/lib/PrismaClient";




const createdUsers: string[] = [];
const createdChatIds: string[] = [];
let modelId = "";
let modelId2 = "";
let connectionId = "";
let connectionId2 = "";

beforeAll(async () => {
  const model = await prismaClient.modelProvider.create({ data: { name: "modelo-test-1", modelName: "m1", isActive: true, userPermission: "USER,STAFF,ADMIN" } });
  const modelo2 = await prismaClient.modelProvider.create({ data: { name: "modelo-test-2", modelName: "m2", isActive: true, userPermission: "USER,STAFF,ADMIN" } });
  const connection = await prismaClient.deviceProviders.create({ data: { name: "conexion-test-1" } });
  const conexion2 = await prismaClient.deviceProviders.create({ data: { name: "conexion-test-2" } });
  modelId = model.id;
  modelId2 = modelo2.id;
  connectionId = connection.id;
  connectionId2 = conexion2.id;
});

afterAll(async () => {
  const bearer = await adminBearer();
  for (const id of createdChatIds) await publicApi().delete(`/api/chats/${id}`).set("Authorization", bearer).catch(() => undefined);
  for (const username of createdUsers) await removeTestUser(username);
  await prismaClient.modelProvider.deleteMany({ where: { name: { in: ["modelo-test-1", "modelo-test-2"] } } }).catch(() => undefined);
  await prismaClient.deviceProviders.deleteMany({ where: { name: { in: ["conexion-test-1", "conexion-test-2"] } } }).catch(() => undefined);
});


async function userWithSession() {
  const owner = await createTestUser("USER");
  createdUsers.push(owner.username);
  const login = await publicApi().post("/api/auth/login").send(owner);
  const cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
  return { owner, cookie };
}

describe("Chats: persistencia de selección", () => {
  it("crea un chat con modelProviderId y connectionId y los devuelve en GET /", async () => {
    const { cookie } = await userWithSession();
    const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({
      title: "Chat con selección",
      modelProviderId: modelId,
      connectionId: connectionId,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.modelProviderId).toBe(modelId);
    expect(created.body.data.connectionId).toBe(connectionId);
    createdChatIds.push(created.body.data.id);

    const list = await publicApi().get("/api/chats").set("Cookie", cookie);
    expect(list.status).toBe(200);
    const chat = (list.body.data ?? []).find((item: any) => item.id === created.body.data.id);
    expect(chat).toBeTruthy();
    expect(chat.modelProviderId).toBe(modelId);
    expect(chat.connectionId).toBe(connectionId);
  });

  it("PATCH actualiza solo los campos presentes y null limpia el valor", async () => {
    const { cookie } = await userWithSession();
    const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({
      modelProviderId: modelId2,
      connectionId: connectionId2,
    });
    const chatId = created.body.data.id;
    createdChatIds.push(chatId);


    const parcial = await publicApi().patch(`/api/chats/${chatId}`).set("Cookie", cookie).send({ connectionId: connectionId2 });
    expect(parcial.status).toBe(200);
    expect(parcial.body.data.modelProviderId).toBe(modelId2);
    expect(parcial.body.data.connectionId).toBe(connectionId2);


    const limpieza = await publicApi().patch(`/api/chats/${chatId}`).set("Cookie", cookie).send({ modelProviderId: null });
    expect(limpieza.status).toBe(200);
    expect(limpieza.body.data.modelProviderId).toBeNull();
    expect(limpieza.body.data.connectionId).toBe(connectionId2);


    const list = await publicApi().get("/api/chats").set("Cookie", cookie);
    const chat = (list.body.data ?? []).find((item: any) => item.id === chatId);
    expect(chat.modelProviderId).toBeNull();
    expect(chat.connectionId).toBe(connectionId2);
  });

  it("PATCH responde 404 si el chat no existe y 403 si no es del usuario", async () => {
    const { cookie } = await userWithSession();
    const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({});
    const chatId = created.body.data.id;
    createdChatIds.push(chatId);

    const inexistente = await publicApi().patch("/api/chats/chat-inexistente-xyz").set("Cookie", cookie).send({ modelProviderId: null });
    expect(inexistente.status).toBe(404);

    const { cookie: cookieAjena } = await userWithSession();
    const ajena = await publicApi().patch(`/api/chats/${chatId}`).set("Cookie", cookieAjena).send({ modelProviderId: "otro-modelo" });
    expect(ajena.status).toBe(403);
  });

  it("POST /:id/messages persiste la selección enviada en el turno", async () => {
    const { cookie } = await userWithSession();
    const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({});
    const chatId = created.body.data.id;
    createdChatIds.push(chatId);


    const saved = await publicApi().post(`/api/chats/${chatId}/messages`).set("Cookie", cookie).send({
      content: "Hola con selección",
      stream: false,
      modelProviderId: modelId,
      connectionId: connectionId,
    });
    expect(saved.status).toBe(201);

    const list = await publicApi().get("/api/chats").set("Cookie", cookie);
    const chat = (list.body.data ?? []).find((item: any) => item.id === chatId);
    expect(chat.modelProviderId).toBe(modelId);
    expect(chat.connectionId).toBe(connectionId);
  });
});


describe("Chats: persistencia del proyecto GNS3", () => {
  it("crea un chat con gns3ProjectId y lo devuelve en GET /", async () => {
    const { cookie } = await userWithSession();
    const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({
      title: "Chat con proyecto GNS3",
      gns3ProjectId: "proyecto-gns3-1",
    });
    expect(created.status).toBe(201);
    expect(created.body.data.gns3ProjectId).toBe("proyecto-gns3-1");
    createdChatIds.push(created.body.data.id);

    const list = await publicApi().get("/api/chats").set("Cookie", cookie);
    const chat = (list.body.data ?? []).find((item: any) => item.id === created.body.data.id);
    expect(chat).toBeTruthy();
    expect(chat.gns3ProjectId).toBe("proyecto-gns3-1");
  });

  it("PATCH actualiza el proyecto y null lo limpia", async () => {
    const { cookie } = await userWithSession();
    const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({});
    const chatId = created.body.data.id;
    createdChatIds.push(chatId);
    expect(created.body.data.gns3ProjectId).toBeNull();

    const actualizado = await publicApi().patch(`/api/chats/${chatId}`).set("Cookie", cookie).send({ gns3ProjectId: "proyecto-gns3-2" });
    expect(actualizado.status).toBe(200);
    expect(actualizado.body.data.gns3ProjectId).toBe("proyecto-gns3-2");

    const limpieza = await publicApi().patch(`/api/chats/${chatId}`).set("Cookie", cookie).send({ gns3ProjectId: null });
    expect(limpieza.status).toBe(200);
    expect(limpieza.body.data.gns3ProjectId).toBeNull();
  });

  it("POST /:id/messages persiste el gns3ProjectId enviado en el turno", async () => {
    const { cookie } = await userWithSession();
    const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({});
    const chatId = created.body.data.id;
    createdChatIds.push(chatId);


    const saved = await publicApi().post(`/api/chats/${chatId}/messages`).set("Cookie", cookie).send({
      content: "Hola con proyecto GNS3",
      stream: false,
      gns3ProjectId: "proyecto-turno-gns3",
    });
    expect(saved.status).toBe(201);

    const list = await publicApi().get("/api/chats").set("Cookie", cookie);
    const chat = (list.body.data ?? []).find((item: any) => item.id === chatId);
    expect(chat.gns3ProjectId).toBe("proyecto-turno-gns3");
  });

  it("un usuario ajeno no puede PATCHear el proyecto (403)", async () => {
    const { cookie } = await userWithSession();
    const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({ gns3ProjectId: "proyecto-gns3-3" });
    const chatId = created.body.data.id;
    createdChatIds.push(chatId);

    const { cookie: cookieAjena } = await userWithSession();
    const ajena = await publicApi().patch(`/api/chats/${chatId}`).set("Cookie", cookieAjena).send({ gns3ProjectId: "proyecto-ajeno" });
    expect(ajena.status).toBe(403);


    const list = await publicApi().get("/api/chats").set("Cookie", cookie);
    const chat = (list.body.data ?? []).find((item: any) => item.id === chatId);
    expect(chat.gns3ProjectId).toBe("proyecto-gns3-3");
  });
});
