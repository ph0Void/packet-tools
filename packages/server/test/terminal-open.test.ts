

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  nodes: [] as any[],
}));

vi.mock("@/client/Gns3Client", () => ({
  Gns3Client: {
    forRequest: async () => ({
      getNodes: async () => mockState.nodos,
    }),
  },
}));

import {
  TerminalOpenBroker,
  terminalOpenBroker,
  type TerminalOpenRequestMeta,
} from "@/agent/approval/TerminalOpenBroker";
import { openGns3ConsoleTool } from "@/agent/tools/OpenConsoleTools";
import {
  buildTerminalFingerprint,
  terminalSessionHub,
} from "@/sockets/TerminalSessionHub";
import { requestContext, type RequestUser } from "@/utils/RequestContext";
import { createTestUser, publicApi, removeTestUser } from "./helpers";


function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function terminalOpenMeta(
  overrides: Partial<TerminalOpenRequestMeta> = {},
): TerminalOpenRequestMeta {
  return {
    chatId: "chat-test",
    userId: "u1",
    toolCallId: `tc-${Math.random().toString(36).slice(2, 10)}`,
    toolName: "open_terminal_console",
    summary: "Abrir consola serial COM6 (9600 baudios)",
    payload: { type: "SERIAL", serialPort: "COM6", baudRate: 9600 },
    ...overrides,
  };
}


async function waitPending(chatId: string, timeoutMs = 2000) {
  const start = Date.now();
  while (true) {
    const pending = terminalOpenBroker
      .listByChat(chatId)
      .find((entry) => entry.status === "pending");
    if (pending) return pending;
    if (Date.now() - start >= timeoutMs) {
      throw new Error("No se registró la solicitud de apertura a tiempo.");
    }
    await delay(10);
  }
}

describe("TerminalOpenBroker", () => {
  let broker: TerminalOpenBroker;

  beforeEach(() => {
    broker = new TerminalOpenBroker();
  });

  afterEach(() => {

    broker.clear();
  });

  it("request + resolve accepted resuelve la promesa con la sesión", async () => {
    let requestId = "";
    const promise = broker.request(terminalOpenMeta(), {
      onPending: (snapshot) => {
        requestId = snapshot.requestId;
      },
    });
    expect(requestId).not.toBe("");
    expect(broker.get(requestId)?.status).toBe("pending");

    const resolved = broker.resolve(
      requestId,
      { accepted: true, sessionId: "s1" },
      { id: "u1" },
    );
    expect(resolved?.status).toBe("accepted");

    await expect(promise).resolves.toEqual({ accepted: true, sessionId: "s1" });
    expect(broker.get(requestId)?.status).toBe("accepted");
  });

  it("resolve rejected devuelve accepted false con el error de la UI", async () => {
    let requestId = "";
    const promise = broker.request(terminalOpenMeta(), {
      onPending: (snapshot) => {
        requestId = snapshot.requestId;
      },
    });

    broker.resolve(
      requestId,
      { accepted: false, error: "el usuario canceló la conexión" },
      { id: "u1" },
    );

    await expect(promise).resolves.toEqual({
      accepted: false,
      error: "el usuario canceló la conexión",
    });
    expect(broker.get(requestId)?.status).toBe("rejected");
  });

  it("expira cuando vence el ttl configurado", async () => {
    const promise = broker.request(terminalOpenMeta({ chatId: "chat-timeout" }), {
      ttlMs: 50,
    });
    const [input] = broker.listByChat("chat-timeout");
    expect(input.status).toBe("pending");

    await expect(promise).resolves.toEqual({
      accepted: false,
      error: "expired",
    });
    expect(broker.get(input.requestId)?.status).toBe("expired");
  });

  it("valida el dueño y es idempotente al repetir el resolve", async () => {
    let requestId = "";
    const promise = broker.request(terminalOpenMeta({ chatId: "chat-actor" }), {
      onPending: (snapshot) => {
        requestId = snapshot.requestId;
      },
    });


    expect(
      broker.resolve(requestId, { accepted: true }, { id: "otro-usuario" }),
    ).toBeNull();
    await delay(20);
    expect(broker.get(requestId)?.status).toBe("pending");


    expect(
      broker.resolve(requestId, { accepted: true, sessionId: "s1" }, { id: "u1" })
        ?.status,
    ).toBe("accepted");
    expect(
      broker.resolve(requestId, { accepted: false }, { id: "u1" })?.status,
    ).toBe("accepted");

    await expect(promise).resolves.toEqual({ accepted: true, sessionId: "s1" });
  });

  it("cancela las pendientes del chat", async () => {
    const first = broker.request(terminalOpenMeta({ chatId: "chat-cancelar" }));
    const ajena = broker.request(
      terminalOpenMeta({ chatId: "chat-otro", toolCallId: "tc-otro" }),
    );

    expect(broker.cancelChat("chat-cancelar", "client_abort")).toBe(1);
    await expect(first).resolves.toMatchObject({
      accepted: false,
      error: "client_abort",
    });


    const [pendingAjena] = broker.listByChat("chat-otro");
    expect(pendingAjena.status).toBe("pending");
    broker.resolve(pendingAjena.requestId, { accepted: true }, { id: "u1" });
    await expect(ajena).resolves.toMatchObject({ accepted: true });
  });
});

describe("POST /api/chats/terminal-open/:requestId", () => {
  const createdUsers: string[] = [];

  afterEach(() => {
    terminalOpenBroker.clear();
  });

  afterAll(async () => {
    terminalOpenBroker.clear();
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
    for (const username of createdUsers) await removeTestUser(username);
  });

  
  async function loginWithCookie(user: { username: string; password: string }) {
    const response = await publicApi().post("/api/auth/login").send(user);
    const cookie = (response.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    return { cookie, id: String(response.body?.data?.id ?? "") };
  }

  it("el dueño ADMIN resuelve la solicitud y el POST repetido es idempotente", async () => {
    const admin = await createTestUser("ADMIN");
    createdUsers.push(admin.username);
    const { cookie, id } = await loginWithCookie(admin);

    let requestId = "";
    const promise = terminalOpenBroker.request(
      {
        chatId: "chat-endpoint",
        userId: id,
        toolCallId: "tc-endpoint",
        toolName: "open_terminal_console",
        summary: "Abrir consola serial COM9 (9600 baudios)",
        payload: { type: "SERIAL", serialPort: "COM9", baudRate: 9600 },
      },
      {
        onPending: (snapshot) => {
          requestId = snapshot.requestId;
        },
      },
    );

    const aceptada = await publicApi()
      .post(`/api/chats/terminal-open/${requestId}`)
      .set("Cookie", cookie)
      .send({ accepted: true, sessionId: "s-9" });

    expect(aceptada.status).toBe(200);
    expect(aceptada.body).toMatchObject({
      success: true,
      data: { requestId, accepted: true },
    });
    await expect(promise).resolves.toEqual({
      accepted: true,
      sessionId: "s-9",
    });


    const repetida = await publicApi()
      .post(`/api/chats/terminal-open/${requestId}`)
      .set("Cookie", cookie)
      .send({ accepted: false });

    expect(repetida.status).toBe(200);
    expect(repetida.body.data.accepted).toBe(true);
  });

  it("404 con un requestId inexistente", async () => {
    const admin = await createTestUser("ADMIN");
    createdUsers.push(admin.username);
    const { cookie } = await loginWithCookie(admin);

    const reply = await publicApi()
      .post("/api/chats/terminal-open/request-no-existe")
      .set("Cookie", cookie)
      .send({ accepted: true });

    expect(reply.status).toBe(404);
    expect(reply.body.success).toBe(false);
    expect(reply.body.data).toBeNull();
  });

  it("401 sin autenticación", async () => {
    const reply = await publicApi()
      .post("/api/chats/terminal-open/cualquiera")
      .send({ accepted: true });

    expect(reply.status).toBe(401);
    expect(reply.body.success).toBe(false);
  });
});

describe("openGns3Console", () => {
  const nodeTelnet = {
    node_id: "n-1",
    name: "R1",
    node_type: "dynamips",
    status: "started",
    console_type: "telnet",
    console_host: "127.0.0.1",
    console: 5002,
  };

  beforeEach(() => {
    mockState.nodos = [nodeTelnet];
  });

  afterEach(() => {
    terminalOpenBroker.clear();
    terminalSessionHub.clear();
    terminalSessionHub.stopKeepalive();
  });

  
  function contextWithChannel(overrides: Partial<RequestUser> = {}) {
    const emit = vi.fn();
    const user: RequestUser = {
      id: "u1",
      username: "tester",
      role: "ADMIN",
      gns3ProjectId: "p-1",
      approvalChannel: { emit, chatId: "chat-test" },
      ...overrides,
    };
    return { emit, user };
  }

  
  function recordSessionTelnet() {
    terminalSessionHub.register({
      socketId: "s-gns3",
      userId: "u1",
      providerId: null,
      protocol: "TELNET",
      deviceName: "GNS3 · R1",
      fingerprint: buildTerminalFingerprint({
        protocol: "TELNET",
        host: "127.0.0.1",
        port: 5002,
      }),
      write: () => {},
      isAlive: () => true,
    });
    terminalSessionHub.recordData("s-gns3", "\r\nR1# ");
  }

  it("emite la solicitud Telnet, espera la confirmación y fija la sesión del turno", async () => {
    const { emit, user } = contextWithChannel();
    let pending: Awaited<ReturnType<typeof waitPending>> | null = null;

    const output = await requestContext.run(user, async () => {
      const promise = openGns3ConsoleTool.invoke({
        nodeName: "R1",
      }) as Promise<string>;

      pending = await waitPending("chat-test");
      recordSessionTelnet();
      terminalOpenBroker.resolve(
        pending.requestId,
        { accepted: true, sessionId: "s-gns3" },
        { id: "u1" },
      );

      return promise;
    });

    const json = JSON.parse(output);
    expect(json.success).toBe(true);
    expect(json.sessionId).toBe("s-gns3");
    expect(json.prompt).toBe("R1#");


    expect(user.terminalSessionId).toBe("s-gns3");


    const apertura = emit.mock.calls.find(
      ([event]) => event === "terminal_open_requested",
    );
    expect(apertura?.[1]).toMatchObject({
      requestId: pending?.requestId,
      toolName: "openGns3Console",
      summary: "Abrir consola del nodo R1 en 127.0.0.1:5002",
      autoOpen: false,
      payload: {
        type: "TELNET",
        host: "127.0.0.1",
        port: 5002,
        deviceName: "GNS3 · R1",
      },
    });

    const resolved = emit.mock.calls.find(
      ([event]) => event === "terminal_open_resolved",
    );
    expect(resolved?.[1]).toMatchObject({
      requestId: pending?.requestId,
      accepted: true,
      sessionId: "s-gns3",
    });
  });

  it("rechaza si el nodo está apagado", async () => {
    mockState.nodos = [{ ...nodeTelnet, status: "stopped" }];
    const { user } = contextWithChannel();

    await expect(
      requestContext.run(user, () =>
        openGns3ConsoleTool.invoke({ nodeName: "R1" }),
      ),
    ).rejects.toThrow(/apagado/);
  });

  it("rechaza si la consola del nodo no es Telnet", async () => {
    mockState.nodos = [{ ...nodeTelnet, console_type: "none" }];
    const { user } = contextWithChannel();

    await expect(
      requestContext.run(user, () =>
        openGns3ConsoleTool.invoke({ nodeName: "R1" }),
      ),
    ).rejects.toThrow(/solo se soporta consola Telnet/);
  });

  it("falla con mensaje guiado si no hay proyecto activo ni projectId", async () => {
    const { user } = contextWithChannel({ gns3ProjectId: null });

    await expect(
      requestContext.run(user, () =>
        openGns3ConsoleTool.invoke({ nodeName: "R1" }),
      ),
    ).rejects.toThrow(/No hay proyecto GNS3 activo/);
  });
});
