import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";

let createdUsername = "";
afterAll(async () => { if (createdUsername) await removeTestUser(createdUsername); });

describe("Gestión de usuarios /api/users", () => {
  it("cualquier usuario autenticado puede listar usuarios sin ver contraseñas", async () => {
    const user = await createTestUser("USER");
    createdUsername = user.username;
    const login = await publicApi().post("/api/auth/login").send(user);
    const cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const response = await publicApi().get("/api/users").set("Cookie", cookie);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
    for (const item of response.body.data) {
      expect(item.password).toBeUndefined();
      expect(item.token).toBeUndefined();
    }
  });

  it("USER no puede crear usuarios (403)", async () => {
    const user = await createTestUser("USER");
    createdUsername = user.username;
    const login = await publicApi().post("/api/auth/login").send(user);
    const cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const response = await publicApi().post("/api/users").set("Cookie", cookie).send({ username: `hack_${Date.now()}`, password: "secreto123", role: "ADMIN" });
    expect(response.status).toBe(403);
  });

  it("sin autenticación responde 401", async () => {
    const response = await publicApi().get("/api/users");
    expect(response.status).toBe(401);
  });
});

describe("RBAC con ADMIN sobre /api/users", () => {
  it("ADMIN crea un STAFF, lo edita a ADMIN y lo elimina", async () => {
    const bearer = await adminBearer();
    const username = `staff_it_${Date.now()}`;
    const created = await publicApi().post("/api/users").set("Authorization", bearer).send({ username, password: "clave_segura_1", role: "STAFF" });
    expect(created.status).toBe(201);
    expect(created.body.data.role).toBe("STAFF");
    const userId = created.body.data.id;

    const updated = await publicApi().put(`/api/users/${userId}`).set("Authorization", bearer).send({ role: "ADMIN" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.role).toBe("ADMIN");

    const removed = await publicApi().delete(`/api/users/${userId}`).set("Authorization", bearer);
    expect([200, 204]).toContain(removed.status);

    const verify = await publicApi().get("/api/users").set("Authorization", bearer);
    expect((verify.body.data ?? []).some((item: any) => item.id === userId)).toBe(false);
  });

  it("ADMIN rechaza crear usuario con rol inexistente (400)", async () => {
    const bearer = await adminBearer();
    const response = await publicApi().post("/api/users").set("Authorization", bearer).send({ username: `bad_role_${Date.now()}`, password: "clave_segura_1", role: "SUPERGOD" });
    expect(response.status).toBe(400);
  });
});
