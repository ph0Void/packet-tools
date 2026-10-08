import { io, Socket } from "socket.io-client";
import { prismaClient } from "@/prisma/lib/PrismaClient";

const BASE = "http://localhost:7531";

async function main() {
  const args = process.argv.slice(2);
  const queueFlagIndex = args.indexOf("--cola");
  const getFlagValue = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const hit = args.find((arg) => arg.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
  };
  const queueLines = Number(getFlagValue("cola") ?? (queueFlagIndex >= 0 ? args[queueFlagIndex + 1] : 0)) || 0;
  const fastPath = args.includes("--fast");
  const question =
    args.find((arg) => !arg.startsWith("--")) ??
    "quiero saber el modelo del sistema";

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "admin123" }),
  });
  if (!loginRes.ok) throw new Error(`login falló: ${loginRes.status}`);
  const cookie = (loginRes.headers.get("set-cookie") ?? "").split(";")[0];
  console.log("✔ login admin");

  const provider = await prismaClient.deviceProviders.findFirst({
    where: { name: (getFlagValue("device") ?? "TEST_MIKROTIK") },
  });
  if (!provider) throw new Error("No está el DeviceProvider TEST_MIKROTIK");
  console.log(`✔ conexión: ${provider.name} ${provider.protocol} ${provider.host}:${provider.port}`);

  const socket = io(BASE, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { Cookie: cookie },
  });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (error) => reject(error));
    setTimeout(() => reject(new Error("timeout conectando socket")), 10000);
  });
  let output = "";
  socket.on("terminal:data", (chunk: string) => { output += String(chunk); });
  const connectedPromise = new Promise<any>((resolve) => socket.on("terminal:connected", resolve));
  const terminalErrorPromise = new Promise<any>((resolve) => socket.on("terminal:error", resolve));
  socket.emit("terminal:connect", { providerId: provider.id });
  const info = await Promise.race([connectedPromise, terminalErrorPromise, new Promise((r) => setTimeout(() => r({ message: "timeout" }), 25000))]);
  if (!info?.success) throw new Error(`no se pudo conectar la consola: ${JSON.stringify(info)}`);
  console.log(`✔ consola viva (${info.type}) sesión=${info.sessionId}`);

  const username = getFlagValue("user") ?? (provider.username ?? "");
  const password = getFlagValue("pass") ?? (provider.password ?? "");
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  if (username || getFlagValue("pass") !== undefined) {
    await wait(1200);
    output = "";
    socket.emit("terminal:data", `${username}\r\n`);
    await wait(1500);
    socket.emit("terminal:data", `${password}\r\n`);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await wait(2000);
      if (/\[admin@[^\]]+\]\s*>/.test(output)) break;
      if (/software license/i.test(output)) {
        output = "";
        socket.emit("terminal:data", "n\r\n");
      }
    }
    const prompt = /\[admin@[^\]]+\]\s*>/.exec(output);
    console.log(`✔ login "${username}"/"${password ? "***" : "(vacía)"}" → prompt: ${prompt ? JSON.stringify(prompt[0].trim()) : "NINGUNO"}`);
    if (!prompt) console.log(`  cola: ${JSON.stringify(output.slice(-260))}`);
  }

  const chatResponse = await fetch(`${BASE}/api/chats`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ title: `diag-telnet-${Date.now()}` }),
  });
  const chat = (await chatResponse.json()) as any;
  const chatId = chat.data.id;
  console.log(`✔ chat ${chatId}`);

  console.log(`\n─── TURNO: "${question}" | cola=${queueLines} | fastPath=${fastPath} ───`);
  const terminalTail = queueLines > 0 ? output.slice(-8000) : undefined;
  if (terminalTail) {
    console.log(`  cola a enviar: ${terminalTail.length} chars crudos (ANSI y eco incluidos)`);
  }
  const startTime = Date.now();
  const response = await fetch(`${BASE}/api/chats/${chatId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      content: question,
      stream: true,
      origin: "terminal",
      terminalSessionId: info.sessionId,
      terminalContextLines: queueLines,
      ...(terminalTail ? { terminalTail } : {}),
      clientMessageId: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }),
  });
  if (!response.ok) throw new Error(`POST messages: ${response.status} ${await response.text()}`);

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const eventCounts: Record<string, number> = {};
  const tools: { name: string; status: string; output?: string }[] = [];
  let answer = "";
  let finalMessage = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const block of parts) {
      const lines = block.split("\n");
      const eventLine = lines.find((line) => line.startsWith("event:"));
      const dataLine = lines.find((line) => line.startsWith("data:"));
      if (!eventLine || !dataLine) continue;
      const eventType = eventLine.slice(6).trim();
      let event: any;
      try {
        event = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      eventCounts[eventType] = (eventCounts[eventType] ?? 0) + 1;
      if (eventType === "tool_call_start") {
        tools.push({ name: event.name ?? event.tool, status: "running" });
      }
      if (eventType === "tool_call_result") {
        const toolEntry = tools.find((x) => x.name === (event.name ?? event.tool));
        if (toolEntry) toolEntry.status = event.status ?? "?";
        else tools.push({ name: event.name ?? event.tool, status: event.status ?? "?" });
        if (event.output) toolEntry!.output = String(event.output).slice(0, 400);
      }
      if (eventType === "chunk" || eventType === "message" || eventType === "answer" || eventType === "assistant_message") {
        answer += String(event.content ?? event.text ?? event.delta ?? "");
      }
      if (eventType === "error") finalMessage = `ERROR ${event.code ?? ""} ${event.message ?? ""}`;
      if (eventType === "complete") finalMessage = String(event.content ?? event.answer ?? finalMessage);
    }
  }
  const elapsedMs = Date.now() - startTime;

  console.log(`\nEventos: ${JSON.stringify(eventCounts)}`);
  console.log(`Tool calls (${tools.length}):`);
  for (const toolEntry of tools) console.log(`  · ${toolEntry.name} → ${toolEntry.status}${toolEntry.output ? `\n      ${toolEntry.output.replace(/\n/g, "\n      ").slice(0, 300)}` : ""}`);
  console.log(`\nRespuesta del agente:\n${answer.slice(0, 1200)}`);
  console.log(`\nFin de turno: ${finalMessage.slice(0, 300)}`);
  console.log(`Duración: ${elapsedMs} ms`);

  const persistedMsg = await prismaClient.message.findFirst({
    where: { chatId, role: "user" },
    orderBy: { createdAt: "desc" },
  });
  const hasTail = Boolean(persistedMsg?.content?.includes("Última salida de terminal"));
  console.log(`\nPersisted user content tiene volcado: ${hasTail ? "SÍ (mal)" : "no (bien)"}`);
  console.log(`Persisted content: ${JSON.stringify((persistedMsg?.content ?? "").slice(0, 200))}`);

  socket.disconnect();
  await prismaClient.$disconnect();
}

main().catch(async (error) => {
  console.error("FALLO:", error?.message ?? error);
  await prismaClient.$disconnect().catch(() => undefined);
  process.exit(1);
});
