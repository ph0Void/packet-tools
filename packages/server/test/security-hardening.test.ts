import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { io, Socket } from "socket.io-client";
import request from "supertest";
import { adminBearer, createTestUser, removeTestUser } from "./helpers";
import { app, server } from "@/app";

const createdUsers: string[] = [];
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
    (server as HttpServer).listen(0);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const username of createdUsers) await removeTestUser(username);
  if ((server as HttpServer).listening) await new Promise<void>((resolve) => server.close(() => resolve()));
});

function connect(options: { query?: Record<string, string>; cookie?: string; auth?: Record<string, unknown> }): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ["websocket"],
      reconnection: false,
      query: options.query,
      auth: options.auth,
      extraHeaders: options.cookie ? { Cookie: options.cookie } : undefined,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error: Error) => reject(error));
    setTimeout(() => reject(new Error("Timeout conectando socket")), 10000);
  });
}

async function loginCookie(user: { username: string; password: string }): Promise<string> {
  const login = await request(app).post("/api/auth/login").send(user);
  return (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
}

describe("Seguridad: sockets exentos de JWT", () => {
  it("packet-tracer sin secreto es rechazado cuando PT_EXTENSION_SECRET está configurado", async () => {
    process.env.PT_EXTENSION_SECRET = "secreto-de-prueba";
    try {
      await expect(connect({ query: { clientType: "packet-tracer" } })).rejects.toThrow();
      const ok = await connect({ query: { clientType: "packet-tracer" }, auth: { secret: "secreto-de-prueba" } });
      ok.disconnect();
    } finally {
      delete process.env.PT_EXTENSION_SECRET;
    }
  });

  it("backend-agent sin secreto es rechazado cuando PT_EXTENSION_SECRET está configurado", async () => {
    process.env.PT_EXTENSION_SECRET = "secreto-de-prueba";
    try {
      await expect(connect({ query: { clientType: "backend-agent" } })).rejects.toThrow();
    } finally {
      delete process.env.PT_EXTENSION_SECRET;
    }
  });
});

describe("Seguridad: terminal:connect con rol", () => {
  it("un usuario USER no puede abrir una sesión de terminal interactiva", async () => {
    const user = await createTestUser("USER");
    createdUsers.push(user.username);
    const socket = await connect({ cookie: await loginCookie(user) });
    const errorReceived = new Promise<any>((resolve) => socket.on("terminal:error", resolve));
    socket.emit("terminal:connect", { providerId: "id-inexistente-xyz" });
    const error = await errorReceived;
    expect(String(error.message)).toMatch(/rol|permiso|autoriz/i);
    socket.disconnect();
  }, 25000);
});

describe("Seguridad: tool_call inyectable", () => {
  it("tool_call desde un usuario USER no se reenvía a la extensión", async () => {
    const extension = await connect({ query: { clientType: "packet-tracer" } });
    const user = await createTestUser("USER");
    createdUsers.push(user.username);
    const socket = await connect({ cookie: await loginCookie(user) });

    let received = false;
    extension.on("tool_call", () => { received = true; });
    socket.emit("tool_call", { tool_call_id: "inyeccion-1", tool_name: "clearWorkspace", tool_input: {} });
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(received).toBe(false);

    socket.disconnect();
    extension.disconnect();
  }, 25000);
});

describe("Seguridad: IDOR en DELETE /api/chats/:id", () => {
  it("un STAFF no puede borrar el chat de otro usuario", async () => {
    const owner = await createTestUser("USER");
    createdUsers.push(owner.username);
    const staff = await createTestUser("STAFF");
    createdUsers.push(staff.username);

    const ownerLogin = await request(app).post("/api/auth/login").send(owner);
    const ownerCookie = (ownerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const created = await request(app).post("/api/chats").set("Cookie", ownerCookie).send({ title: "chat-ajeno" });
    const chatId = created.body.data.id as string;

    const staffLogin = await request(app).post("/api/auth/login").send(staff);
    const staffCookie = (staffLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const forbidden = await request(app).delete(`/api/chats/${chatId}`).set("Cookie", staffCookie);
    expect([403, 404]).toContain(forbidden.status);


    const adminLogin = await request(app).post("/api/auth/login").send({ username: "admin", password: "admin123" });
    const adminCookie = (adminLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const allowed = await request(app).delete(`/api/chats/${chatId}`).set("Cookie", adminCookie);
    expect(allowed.status).toBe(200);
  });
});

describe("Seguridad: CORS y Origin", () => {
  it("una ruta mutante con Origin no permitido recibe 403", async () => {
    const token = await adminBearer();
    const res = await request(app)
      .post("/api/chats")
      .set("Authorization", token)
      .set("Origin", "https://evil.example.com")
      .send({ title: "cors-test" });
    expect(res.status).toBe(403);
  });

  it("GET permitido desde cualquier origen no lleva allow-credentials para orígenes ajenos", async () => {
    const res = await request(app).get("/api/health").set("Origin", "https://evil.example.com");
    expect(res.headers["access-control-allow-origin"]).not.toBe("https://evil.example.com");
  });
});

describe("Seguridad: rate limit en mensajes", () => {
  it("superado el límite responde 429", async () => {
    process.env.CHAT_MESSAGES_RATE_LIMIT = "3";
    try {
      const token = await adminBearer();
      const chat = await request(app).post("/api/chats").set("Authorization", token).send({ title: "rl" });
      const chatId = chat.body.data.id as string;
      let lastStatus = 0;
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post(`/api/chats/${chatId}/messages`)
          .set("Authorization", token)
          .send({ content: "hola", stream: false });
        lastStatus = res.status;
        if (lastStatus === 429) break;
      }
      expect(lastStatus).toBe(429);
    } finally {
      delete process.env.CHAT_MESSAGES_RATE_LIMIT;
    }
  }, 30000);
});
