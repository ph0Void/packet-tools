

import { afterAll, afterEach, describe, expect, it, vi } from "vitest";


interface TurnCapturado {
  messages: Array<{ content: unknown }>;
}


const turns = vi.hoisted(() => [] as TurnCapturado[]);

vi.mock("@/agent/deep/turn", () => ({
  createTurnStream: async (args: { messages: Array<{ content: unknown }> }) => {
    turns.push({ messages: args.messages });
    return {
      
      stream: (async function* () {})(),
      deep: true,
    };
  },
}));

const { publicApi, createTestUser, removeTestUser } = await import("./helpers");
const { prismaClient } = await import("@/prisma/lib/PrismaClient");


const MARKER = "--- Última salida de terminal ---";


const TAIL_RAW = [
  "\x1b[36m/system pr\x1b[0m",
  "/system pri",
  "/system prin",
  "/system print",
  "\x1b[2J\x1b[Hterminal#print",
  "\x1b[2J\x1b[Hterminal#print",
  '  type: "MikroTik"',
  '  version: "7.10 (stable)"',
  "terminal#print\rterminal#print",
].join("\n");


const TAIL_SANEADO = [
  "/system print",
  "terminal#print",
  'type: "MikroTik"',
  'version: "7.10 (stable)"',
  "terminal#print",
].join("\n");

const createdUsers: string[] = [];
const createdChatIds: string[] = [];


async function userWithSession() {
  const owner = await createTestUser("USER");
  createdUsers.push(owner.username);
  const login = await publicApi().post("/api/auth/login").send(owner);
  const cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
  return { owner, cookie };
}


async function chatEmpty(cookie: string): Promise<string> {
  const created = await publicApi()
    .post("/api/chats")
    .set("Cookie", cookie)
    .send({});
  createdChatIds.push(created.body.data.id);
  return created.body.data.id as string;
}


async function sendTurn(
  cookie: string,
  chatId: string,
  body: Record<string, unknown>,
) {
  turns.length = 0;
  const res = await publicApi()
    .post(`/api/chats/${chatId}/messages`)
    .set("Cookie", cookie)
    .send({ content: "revisa la consola", stream: true, ...body });
  return res;
}


function textOfLastMessage(turn: TurnCapturado): string {
  const last = turn.messages[turn.messages.length - 1];
  const content = last?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) =>
        block?.type === "text" ? String(block.text ?? "") : "",
      )
      .join("\n");
  }
  return "";
}

afterEach(() => {
  turns.length = 0;
});

afterAll(async () => {
  for (const id of createdChatIds) {
    await prismaClient.chat.delete({ where: { id } }).catch(() => undefined);
  }
  for (const username of createdUsers) await removeTestUser(username);
});

describe("Contrato del tail de terminal (POST /:id/messages)", () => {
  it("con terminalContextLines=0 el mensaje del modelo NO lleva salida de terminal", async () => {
    const { cookie } = await userWithSession();
    const chatId = await chatEmpty(cookie);

    const res = await sendTurn(cookie, chatId, {
      origin: "terminal",
      terminalContextLines: 0,
      terminalTail: TAIL_RAW,
    });
    expect(res.status).toBe(200);
    expect(turns).toHaveLength(1);

    const text = textOfLastMessage(turns[0]);
    expect(text).toContain("revisa la consola");
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("MikroTik");
  });

  it("sin terminalContextLines (default) tampoco viaja cola aunque venga terminalTail", async () => {
    const { cookie } = await userWithSession();
    const chatId = await chatEmpty(cookie);

    const res = await sendTurn(cookie, chatId, {
      origin: "terminal",
      terminalTail: TAIL_RAW,
    });
    expect(res.status).toBe(200);

    const text = textOfLastMessage(turns[0]);
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("MikroTik");
  });

  it("con terminalContextLines=10 el modelo recibe el tail SANITIZADO y el historial NO", async () => {
    const { cookie } = await userWithSession();
    const chatId = await chatEmpty(cookie);

    const res = await sendTurn(cookie, chatId, {
      origin: "terminal",
      terminalContextLines: 10,
      terminalTail: TAIL_RAW,
    });
    expect(res.status).toBe(200);


    const text = textOfLastMessage(turns[0]);
    expect(text).toContain(MARKER);
    expect(text).toContain("MikroTik");

    expect(text).not.toContain("\x1b");
    expect(text).not.toContain("\r");

    const block = text.split(`${MARKER}\n`)[1] ?? "";
    expect(block.trimEnd()).toBe(TAIL_SANEADO);


    const persistido = await prismaClient.message.findFirst({
      where: { chatId, role: "user" },
      orderBy: { createdAt: "desc" },
    });
    expect(persistido?.content).toBe("revisa la consola");
    expect(persistido?.content).not.toContain(MARKER);
    expect(persistido?.content).not.toContain("MikroTik");
  });

  it("el recorte a N líneas deja las últimas y descarta el resto", async () => {
    const { cookie } = await userWithSession();
    const chatId = await chatEmpty(cookie);

    const res = await sendTurn(cookie, chatId, {
      origin: "terminal",
      terminalContextLines: 10,
      terminalTail: `${Array.from({ length: 40 }, (_, i) => `linea-${i + 1}`).join("\n")}\n`,
    });
    expect(res.status).toBe(200);

    const text = textOfLastMessage(turns[0]);
    expect(text).toContain("linea-40");
    expect(text).not.toContain("linea-1\n");
  });

  it("rechaza terminalContextLines fuera de la lista cerrada con 400", async () => {
    const { cookie } = await userWithSession();
    const chatId = await chatEmpty(cookie);

    for (const invalido of [7, 15, 1000, -10]) {
      const res = await sendTurn(cookie, chatId, {
        origin: "terminal",
        terminalContextLines: invalido,
        terminalTail: TAIL_RAW,
      });
      expect(res.status, `terminalContextLines=${invalido}`).toBe(400);
    }
    expect(turns).toHaveLength(0);
  });

  it("acepta los valores permitidos de la lista (0/10/25/50/100)", async () => {
    const { cookie } = await userWithSession();
    const chatId = await chatEmpty(cookie);

    for (const valid of [0, 10, 25, 50, 100]) {
      const res = await sendTurn(cookie, chatId, {
        origin: "terminal",
        terminalContextLines: valid,
        terminalTail: TAIL_RAW,
      });
      expect(res.status, `terminalContextLines=${valid}`).toBe(200);
    }
  });

  it("un cliente antiguo que pega el tail en content no rompe el turno (se avisa en log)", async () => {
    const { cookie } = await userWithSession();
    const chatId = await chatEmpty(cookie);


    const res = await sendTurn(cookie, chatId, {
      origin: "terminal",
      content: `revisa la consola\n\n--- Última salida de terminal (R1) ---\n${TAIL_RAW}`,
    });
    expect(res.status).toBe(200);


    const text = textOfLastMessage(turns[0]);
    expect(text).toContain("Última salida de terminal");
  });

  it("un terminalTail sin sanitizeo útil no añade bloque (todo eco degenerado)", async () => {
    const { cookie } = await userWithSession();
    const chatId = await chatEmpty(cookie);

    const res = await sendTurn(cookie, chatId, {
      origin: "terminal",
      terminalContextLines: 10,

      terminalTail: "\x1b[2J\x1b[H\x1b[K\x1b[?25l",
    });
    expect(res.status).toBe(200);

    const text = textOfLastMessage(turns[0]);
    expect(text).not.toContain(MARKER);
  });
});
