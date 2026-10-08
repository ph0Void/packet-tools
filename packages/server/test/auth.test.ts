import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createTestUser, publicApi, removeTestUser } from "./helpers";

const createdUsernames: string[] = [];
afterAll(async () => { for (const username of createdUsernames) await removeTestUser(username); });

describe("Autenticación /api/auth", () => {
  it("registra un usuario público con rol USER", async () => {
    const { username, password } = await createTestUser("USER");
    createdUsernames.push(username);
    const response = await publicApi().post("/api/auth/register").send({ username: `${username}_dup`, password });
    createdUsernames.push(`${username}_dup`);
    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.role).toBe("USER");
  });

  it("rechaza registro duplicado con 409", async () => {
    const { username, password } = await createTestUser("USER");
    createdUsernames.push(username);
    const response = await publicApi().post("/api/auth/register").send({ username, password });
    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);
  });

  it("login correcto emite la cookie httpOnly packet-tools-cookie", async () => {
    const { username, password } = await createTestUser("USER");
    createdUsernames.push(username);
    const response = await publicApi().post("/api/auth/login").send({ username, password });
    expect(response.status).toBe(200);
    const cookie = response.headers["set-cookie"]?.[0] ?? "";
    expect(cookie).toContain("packet-tools-cookie=");
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("rechaza credenciales inválidas con 401", async () => {
    const response = await publicApi().post("/api/auth/login").send({ username: "no_existe_xyz", password: "incorrecta123" });
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("GET /api/auth/me sin autenticación responde 401", async () => {
    const response = await publicApi().get("/api/auth/me");
    expect(response.status).toBe(401);
  });

  it("GET /api/auth/me con cookie devuelve el usuario en sesión", async () => {
    const { username, password } = await createTestUser("USER");
    createdUsernames.push(username);
    const login = await publicApi().post("/api/auth/login").send({ username, password });
    const cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const me = await publicApi().get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.data.username).toBe(username);
    expect(me.body.data.role).toBe("USER");
  });

  it("acepta también Authorization: Bearer <token>", async () => {
    const { username, password } = await createTestUser("USER");
    createdUsernames.push(username);
    const login = await publicApi().post("/api/auth/login").send({ username, password });
    const token = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0].replace("packet-tools-cookie=", "");
    const me = await publicApi().get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.username).toBe(username);
  });

  it("logout limpia la sesión", async () => {
    const { username, password } = await createTestUser("USER");
    createdUsernames.push(username);
    const login = await publicApi().post("/api/auth/login").send({ username, password });
    const cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const logout = await publicApi().post("/api/auth/logout").set("Cookie", cookie);
    expect(logout.status).toBe(200);
    const meAfter = await publicApi().get("/api/auth/me").set("Cookie", cookie);
    expect(meAfter.status).toBe(401);
  });
});
