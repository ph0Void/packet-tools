import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server as HttpServer } from "node:http";
import { io, Socket } from "socket.io-client";
import request from "supertest";
import { createTestUser, removeTestUser } from "./helpers";
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

async function loginCookie(user: { username: string; password: string }): Promise<string> {
  const login = await request(app).post("/api/auth/login").send(user);
  return (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
}

function connect(baseUrl: string, options: { query?: Record<string, string>; cookie?: string }): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      transports: ["websocket"],
      reconnection: false,
      query: options.query,
      extraHeaders: options.cookie ? { Cookie: options.cookie } : undefined,
    });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (error: Error) => reject(error));
    setTimeout(() => reject(new Error("Timeout conectando socket")), 10000);
  });
}

describe("Sockets", () => {
  it("rechaza conexiones sin JWT (terminal/dashboard)", async () => {
    await expect(connect(baseUrl, {})).rejects.toThrow(/Autenticación/i);
  });

  it("acepta conexiones autenticadas con la cookie httpOnly del login", async () => {
    const user = await createTestUser("USER");
    createdUsers.push(user.username);
    const socket = await connect(baseUrl, { cookie: await loginCookie(user) });
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it("puente tool_call/tool_result entre agente y simulador (extensión simulada)", async () => {

    const simulator = await connect(baseUrl, { query: { clientType: "packet-tracer" } });
    const agent = await connect(baseUrl, { query: { clientType: "backend-agent" } });

    const received = new Promise<any>((resolve) => simulator.on("tool_call", resolve));
    const answered = new Promise<any>((resolve) => agent.on("tool_result", resolve));

    agent.emit("tool_call", { tool_call_id: "test-tc-1", tool_name: "getNetwork", tool_input: {} });

    const forwarded = await received;
    expect(forwarded.tool_call_id).toBe("test-tc-1");

    simulator.emit("tool_result", { tool_call_id: forwarded.tool_call_id, result: { success: true, devices: [] } });
    const answer = await answered;
    expect(answer.tool_call_id).toBe("test-tc-1");
    expect(answer.result.success).toBe(true);

    agent.disconnect();
    simulator.disconnect();
  });

  it("responde error inmediato si no hay extensión Packet Tracer conectada", async () => {
    const agent = await connect(baseUrl, { query: { clientType: "backend-agent" } });
    const answer = new Promise<any>((resolve) => agent.on("tool_result", resolve));
    agent.emit("tool_call", { tool_call_id: "test-tc-2", tool_name: "addDevice", tool_input: {} });
    const response = await answer;
    expect(response.result.success).toBe(false);
    expect(String(response.result.error)).toMatch(/Packet Tracer/i);
    agent.disconnect();
  });

  it("terminal:connect con proveedor inexistente emite terminal:error", async () => {
    const user = await createTestUser("STAFF");
    createdUsers.push(user.username);
    const socket = await connect(baseUrl, { cookie: await loginCookie(user) });

    const errorReceived = new Promise<any>((resolve) => socket.on("terminal:error", resolve));
    socket.emit("terminal:connect", { providerId: "id-inexistente-xyz" });
    const error = await errorReceived;
    expect(String(error.message)).toMatch(/Proveedor|conectar/i);
    socket.disconnect();
  }, 25000);
});
