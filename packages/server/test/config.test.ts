import { afterAll, describe, expect, it } from "vitest";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";
import { prismaClient } from "@/prisma/lib/PrismaClient";

const createdUsers: string[] = [];
afterAll(async () => {
  await prismaClient.configuration.updateMany({ data: { systemPrompt: null } });
  for (const username of createdUsers) await removeTestUser(username);
});

describe("Configuración /api/config", () => {
  it("USER obtiene la configuración pero no puede modificarla; solo ADMIN actualiza", async () => {
    const viewer = await createTestUser("USER");
    createdUsers.push(viewer.username);
    const viewerLogin = await publicApi().post("/api/auth/login").send(viewer);
    const viewerCookie = (viewerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const staff = await createTestUser("STAFF");
    createdUsers.push(staff.username);
    const staffLogin = await publicApi().post("/api/auth/login").send(staff);
    const staffCookie = (staffLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const initial = await publicApi().get("/api/config").set("Cookie", viewerCookie);
    expect(initial.status).toBe(200);
    expect(initial.body.success).toBe(true);
    expect(typeof initial.body.data.id).toBe("string");
    expect("systemPrompt" in initial.body.data).toBe(true);

    const forbiddenStaff = await publicApi().put("/api/config").set("Cookie", staffCookie).send({ systemPrompt: "no permitido" });
    expect(forbiddenStaff.status).toBe(403);
    const forbiddenUser = await publicApi().put("/api/config").set("Cookie", viewerCookie).send({ systemPrompt: "no permitido" });
    expect(forbiddenUser.status).toBe(403);

    const bearer = await adminBearer();
    const updated = await publicApi().put("/api/config").set("Authorization", bearer).send({ systemPrompt: "Prompt de prueba" });
    expect(updated.status).toBe(200);
    expect(updated.body.success).toBe(true);
    expect(updated.body.data.systemPrompt).toBe("Prompt de prueba");

    const reflected = await publicApi().get("/api/config").set("Authorization", bearer);
    expect(reflected.status).toBe(200);
    expect(reflected.body.data.systemPrompt).toBe("Prompt de prueba");
    expect(reflected.body.data.id).toBe(initial.body.data.id);

    const empty = await publicApi().put("/api/config").set("Authorization", bearer).send({ systemPrompt: "" });
    expect(empty.status).toBe(200);
    expect(empty.body.data.systemPrompt).toBe("");
  });
});
