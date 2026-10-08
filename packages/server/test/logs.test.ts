import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminBearer, createTestUser, ensureTestAdmin, publicApi, removeTestUser } from "./helpers";
import { prismaClient } from "@/prisma/lib/PrismaClient";

const createdUsers: string[] = [];
let topologyId = "";

beforeAll(async () => {
  const admin = await ensureTestAdmin();
  const owner = await prismaClient.user.findUniqueOrThrow({ where: { username: admin.username } });
  const topology = await prismaClient.topology.create({
    data: { name: `topo_logs_${Date.now()}`, topologyJson: JSON.stringify({ nodes: [] }), ownerId: owner.id },
  });
  topologyId = topology.id;
});

afterAll(async () => {
  if (topologyId) await prismaClient.topology.delete({ where: { id: topologyId } }).catch(() => undefined);
  for (const username of createdUsers) await removeTestUser(username);
});

describe("Logs /api/logs", () => {
  it("lista paginada con filtro por level; USER no elimina y ADMIN sí", async () => {
    const levelWarn = `TEST_WARN_${Date.now()}`;
    const infoLog = await prismaClient.log.create({
      data: { level: "TEST_INFO", title: "Log de prueba", content: "Contenido informativo de prueba", topologyId },
    });
    await prismaClient.log.createMany({
      data: [1, 2].map((index) => ({ level: levelWarn, title: `Advertencia ${index}`, content: "Contenido de advertencia", topologyId })),
    });
    const bearer = await adminBearer();

    const list = await publicApi().get("/api/logs").set("Authorization", bearer);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.items)).toBe(true);
    expect(list.body.data.total).toBeGreaterThanOrEqual(1);

    const filtered = await publicApi().get(`/api/logs?level=${levelWarn}`).set("Authorization", bearer);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.total).toBe(2);
    expect(filtered.body.data.items.every((item: any) => item.level === levelWarn)).toBe(true);

    const paged = await publicApi().get("/api/logs?page=2&limit=2").set("Authorization", bearer);
    expect(paged.status).toBe(200);
    expect(paged.body.data.page).toBe(2);
    expect(paged.body.data.limit).toBe(2);
    expect(paged.body.data.items.length).toBeLessThanOrEqual(2);

    const viewer = await createTestUser("USER");
    createdUsers.push(viewer.username);
    const viewerLogin = await publicApi().post("/api/auth/login").send(viewer);
    const viewerCookie = (viewerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    expect((await publicApi().get("/api/logs").set("Cookie", viewerCookie)).status).toBe(200);
    const forbiddenDelete = await publicApi().delete(`/api/logs/${infoLog.id}`).set("Cookie", viewerCookie);
    expect(forbiddenDelete.status).toBe(403);

    const totalBefore = (await publicApi().get("/api/logs").set("Authorization", bearer)).body.data.total;
    const deleted = await publicApi().delete(`/api/logs/${infoLog.id}`).set("Authorization", bearer);
    expect(deleted.status).toBe(200);
    expect(deleted.body.message).toBe("Log eliminado");

    const totalAfter = (await publicApi().get("/api/logs").set("Authorization", bearer)).body.data.total;
    expect(totalAfter).toBe(totalBefore - 1);

    const missing = await publicApi().delete(`/api/logs/${infoLog.id}`).set("Authorization", bearer);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe("Log no encontrado");
  });
});
