import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyCommand, classifyCommands } from "@/agent/security/CommandClassifier";
import { getToolPolicy } from "@/agent/security/ToolPolicy";
import {
  ApprovalBroker,
  approvalBroker,
  type ApprovalRequestMeta,
} from "@/agent/approval/ApprovalBroker";
import {
  TerminalSessionHub,
  buildTerminalFingerprint,
  terminalSessionHub,
  type TerminalSessionRegistration,
} from "@/sockets/TerminalSessionHub";
import { createTestUser, publicApi, removeTestUser } from "./helpers";


function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function loginWithCookie(user: { username: string; password: string }) {
  const response = await publicApi().post("/api/auth/login").send(user);
  const cookie = (response.headers["set-cookie"]?.[0] ?? "").split(";")[0];
  return { cookie, id: String(response.body?.data?.id ?? "") };
}


function approvalMeta(overrides: Partial<ApprovalRequestMeta> = {}): ApprovalRequestMeta {
  return {
    chatId: "chat-test",
    userId: "u1",
    toolCallId: `tc-${Math.random().toString(36).slice(2, 10)}`,
    toolName: "executeSshCommands",
    toolLabel: "Comandos SSH",
    ...overrides,
  };
}


function terminalRegistration(
  overrides: Partial<TerminalSessionRegistration> = {},
): TerminalSessionRegistration {
  return {
    socketId: "s1",
    userId: "u1",
    providerId: "p1",
    protocol: "SSH",
    deviceName: "Router1",
    fingerprint: null,
    write: () => {},
    isAlive: () => true,
    ...overrides,
  };
}

describe("CommandClassifier", () => {
  it("clasifica como readonly los comandos de consulta", () => {
    const commands = [
      "show ip interface brief",
      "ping 8.8.8.8",
      "display current-configuration",
      "traceroute 10.0.0.1",
    ];
    for (const command of commands) {
      expect(classifyCommand(command), command).toBe("readonly");
    }
  });

  it("clasifica como config los comandos que mutan estado", () => {
    const commands = [
      "configure terminal",
      "username admin2 privilege 15 secret Cisco123",
      "shutdown",
      "ip address 10.0.0.1 255.255.255.0",
      "write erase",
      "reload",
    ];
    for (const command of commands) {
      expect(classifyCommand(command), command).toBe("config");
    }
  });

  it("es fail-safe: comando vacío o desconocido es config", () => {
    expect(classifyCommand("")).toBe("config");
    expect(classifyCommand("   ")).toBe("config");
    expect(classifyCommand("comando-raro-xyz")).toBe("config");
  });

  it("respeta los límites de palabra entre prefijos similares", () => {

    expect(classifyCommand("ipconfig /all")).toBe("readonly");
    expect(classifyCommand("ip address 10.0.0.1 255.255.255.0")).toBe("config");

    expect(classifyCommand("do show version")).toBe("readonly");

    expect(classifyCommand("do write erase")).toBe("config");
  });

  it("classifyCommands marca readonly solo cuando TODOS los comandos lo son", () => {
    const onlyRead = classifyCommands(["show version", "ping 8.8.8.8"]);
    expect(onlyRead.level).toBe("readonly");
    expect(onlyRead.configCommands).toEqual([]);
  });

  it("classifyCommands marca config y lista los comandos mutantes", () => {
    const mixto = classifyCommands(["show version", "configure terminal"]);
    expect(mixto.level).toBe("config");
    expect(mixto.configCommands).toContain("configure terminal");
    expect(mixto.configCommands).toHaveLength(1);
  });
});

describe("ToolPolicy", () => {
  it("expone el campo de comandos según la herramienta CLI", () => {
    expect(getToolPolicy("executeSshCommands").commandsField).toBe("commands");
    expect(getToolPolicy("sendSerialCommand").commandsField).toBe("command");
  });

  it("las transferencias del supervisor son internas", () => {
    expect(getToolPolicy("transfer_to_ssh").kind).toBe("internal");
    expect(getToolPolicy("transfer_to_ssh").access).toBe("internal");
  });

  it("las herramientas de consulta de topología son readonly", () => {
    expect(getToolPolicy("getNetwork").access).toBe("readonly");
  });

  it("es fail-safe: una herramienta desconocida es mutating", () => {
    const policy = getToolPolicy("tool_inexistente");
    expect(policy.access).toBe("mutating");
    expect(policy.commandsField).toBeUndefined();
  });
});

describe("ApprovalBroker", () => {
  let broker: ApprovalBroker;

  beforeEach(() => {
    broker = new ApprovalBroker();
  });

  afterEach(() => {

    broker.clear();
  });

  it("request + resolve approved resuelve la promesa y actualiza el estado", async () => {
    const decisionPromise = broker.request(approvalMeta({ chatId: "chat-aprobado" }));
    const [input] = broker.listByChat("chat-aprobado");
    expect(input.status).toBe("pending");

    const resolved = broker.resolve(input.approvalId, "approved", { id: "u1" });
    expect(resolved?.status).toBe("approved");

    await expect(decisionPromise).resolves.toBe("approved");
    expect(broker.get(input.approvalId)?.status).toBe("approved");
  });

  it("un actor ajeno no puede resolver y la promesa sigue pendiente", async () => {
    const decisionPromise = broker.request(approvalMeta({ chatId: "chat-actor" }));
    const [input] = broker.listByChat("chat-actor");

    let result: string | null = null;
    void decisionPromise.then((decision) => {
      result = decision;
    });


    expect(broker.resolve(input.approvalId, "approved", { id: "otro-usuario" })).toBeNull();
    await delay(30);
    expect(result).toBeNull();
    expect(broker.get(input.approvalId)?.status).toBe("pending");


    expect(broker.resolve(input.approvalId, "rejected", { id: "u1" })?.status).toBe("rejected");
    await expect(decisionPromise).resolves.toBe("rejected");
  });

  it("expira la solicitud cuando vence el timeout", async () => {
    const decisionPromise = broker.request(
      approvalMeta({ chatId: "chat-timeout", timeoutMs: 40 }),
    );
    const [input] = broker.listByChat("chat-timeout");

    await delay(120);
    await expect(decisionPromise).resolves.toBe("expired");
    expect(broker.get(input.approvalId)?.status).toBe("expired");
  });

  it("cancelChat rechaza las pendientes del chat y respeta las de otros chats", async () => {
    const first = broker.request(approvalMeta({ chatId: "chat-cancelar", toolCallId: "tc-a" }));
    const second = broker.request(approvalMeta({ chatId: "chat-cancelar", toolCallId: "tc-b" }));
    const foreign = broker.request(approvalMeta({ chatId: "chat-otro", toolCallId: "tc-c" }));

    expect(broker.cancelChat("chat-cancelar", "client_abort")).toBe(2);
    await expect(first).resolves.toBe("rejected");
    await expect(second).resolves.toBe("rejected");


    const [inputAjena] = broker.listByChat("chat-otro");
    expect(inputAjena.status).toBe("pending");
    broker.resolve(inputAjena.approvalId, "approved", { id: "u1" });
    await expect(foreign).resolves.toBe("approved");
  });

  it("resolver dos veces es idempotente: no cambia estado ni resultado", async () => {
    const decisionPromise = broker.request(approvalMeta({ chatId: "chat-idem" }));
    const [input] = broker.listByChat("chat-idem");

    expect(broker.resolve(input.approvalId, "approved", { id: "u1" })?.status).toBe("approved");

    expect(broker.resolve(input.approvalId, "rejected", { id: "u1" })?.status).toBe("approved");

    await expect(decisionPromise).resolves.toBe("approved");
    expect(broker.get(input.approvalId)?.status).toBe("approved");
  });
});

describe("TerminalSessionHub", () => {
  let hub: TerminalSessionHub;

  beforeEach(() => {
    hub = new TerminalSessionHub();
  });

  afterEach(() => {
    hub.clear();
  });

  it("registra la sesión y la encuentra por usuario + proveedor", () => {
    hub.register(terminalRegistration());

    const match = hub.findMatch("u1", "p1");
    expect(match?.socketId).toBe("s1");
    expect(hub.hasMatch("u1", "p1")).toBe(true);
    expect(hub.findMatch("u1", "p2")).toBeNull();
    expect(hub.hasMatch("otro-usuario", "p1")).toBe(false);
  });

  it("ante dos sesiones del mismo proveedor no enruta (ambigüedad)", () => {
    hub.register(terminalRegistration({ socketId: "s1" }));
    hub.register(terminalRegistration({ socketId: "s2" }));

    expect(hub.findMatch("u1", "p1")).toBeNull();
    expect(hub.hasMatch("u1", "p1")).toBe(false);
  });

  it("hace fallback de matching por fingerprint cuando no hay providerId", () => {
    const fingerprint = buildTerminalFingerprint({
      protocol: "SERIAL",
      serialPort: "COM3",
      baudRate: 9600,
    });
    hub.register(
      terminalRegistration({ providerId: null, protocol: "SERIAL", fingerprint }),
    );

    expect(hub.findMatch("u1", null, fingerprint)?.socketId).toBe("s1");
    expect(hub.findMatch("u1", null, "SSH:OTRO:22")).toBeNull();
  });

  it("buildTerminalFingerprint normaliza SERIAL y devuelve null sin datos", () => {
    const fingerprint = buildTerminalFingerprint({
      protocol: "SERIAL",
      serialPort: "COM3",
      baudRate: 9600,
    });
    expect(fingerprint).not.toBeNull();
    expect(fingerprint).toContain("COM3");

    expect(buildTerminalFingerprint({})).toBeNull();

    expect(buildTerminalFingerprint({ protocol: "SSH" })).toBeNull();
  });

  it("runCommands escribe el comando y devuelve la salida capturada", async () => {
    hub.register(
      terminalRegistration({
        write: () => {
          setTimeout(() => hub.recordData("s1", "Router#ok\r\n"), 10);
        },
      }),
    );

    hub.recordData("s1", "Router# ");
    const session = hub.findMatch("u1", "p1");
    expect(session).not.toBeNull();

    const output = await hub.runCommands(session!, ["show version"], {
      idleMs: 50,
      maxMs: 1000,
    });
    expect(output).toContain("ok");
    expect(output).toContain("Router#");
  });

  it("rechaza una segunda ejecución simultánea mientras la consola está ocupada", async () => {
    hub.register(
      terminalRegistration({
        write: () => {
          setTimeout(() => hub.recordData("s1", "Router#ok\r\n"), 10);
        },
      }),
    );
    hub.recordData("s1", "Router# ");
    const session = hub.findMatch("u1", "p1")!;


    const first = hub.runCommands(session, ["show version"], { idleMs: 400, maxMs: 2000 });
    await delay(30);
    await expect(
      hub.runCommands(session, ["show version"], { idleMs: 50, maxMs: 200 }),
    ).rejects.toThrow(/utilizada|operación/i);


    await expect(first).resolves.toContain("ok");
  });
});

describe("POST /api/chats/approvals/:approvalId", () => {
  const createdUsers: string[] = [];

  afterEach(() => {

    approvalBroker.clear();
  });

  afterAll(async () => {
    approvalBroker.clear();
    terminalSessionHub.clear();
    for (const username of createdUsers) await removeTestUser(username);
  });

  it("USER autenticado no puede resolver aprobaciones (403)", async () => {
    const user = await createTestUser("USER");
    createdUsers.push(user.username);
    const { cookie } = await loginWithCookie(user);

    const reply = await publicApi()
      .post("/api/chats/approvals/aprobacion-inexistente")
      .set("Cookie", cookie)
      .send({ decision: "approve" });

    expect(reply.status).toBe(403);
    expect(reply.body.success).toBe(false);
  });

  it("STAFF con approvalId inexistente recibe 404", async () => {
    const staff = await createTestUser("STAFF");
    createdUsers.push(staff.username);
    const { cookie } = await loginWithCookie(staff);

    const reply = await publicApi()
      .post("/api/chats/approvals/approval-no-existe")
      .set("Cookie", cookie)
      .send({ decision: "approve" });

    expect(reply.status).toBe(404);
    expect(reply.body.data).toBeNull();
  });

  it("solo el dueño puede aprobar y el POST repetido es idempotente", async () => {
    const staff = await createTestUser("STAFF");
    createdUsers.push(staff.username);
    const { cookie, id: staffId } = await loginWithCookie(staff);

    const foreign = await createTestUser("STAFF");
    createdUsers.push(foreign.username);
    const { cookie: cookieAjena } = await loginWithCookie(foreign);

    let approvalId = "";
    const decisionPromise = approvalBroker.request(
      {
        chatId: "test-chat",
        userId: staffId,
        toolCallId: "tc-1",
        toolName: "executeSshCommands",
        toolLabel: "Comandos SSH",
      },
      {
        onPending: (snapshot) => {
          approvalId = snapshot.approvalId;
        },
      },
    );
    expect(approvalId).not.toBe("");


    const noAutorizado = await publicApi()
      .post(`/api/chats/approvals/${approvalId}`)
      .set("Cookie", cookieAjena)
      .send({ decision: "approve" });
    expect(noAutorizado.status).toBe(404);
    expect(approvalBroker.get(approvalId)?.status).toBe("pending");


    const approved = await publicApi()
      .post(`/api/chats/approvals/${approvalId}`)
      .set("Cookie", cookie)
      .send({ decision: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.success).toBe(true);
    expect(approved.body.data.decision).toBe("approved");
    await expect(decisionPromise).resolves.toBe("approved");


    const repetida = await publicApi()
      .post(`/api/chats/approvals/${approvalId}`)
      .set("Cookie", cookie)
      .send({ decision: "approve" });
    expect(repetida.status).toBe(200);
    expect(repetida.body.data.decision).toBe("approved");
    expect(approvalBroker.get(approvalId)?.status).toBe("approved");
  });
});
