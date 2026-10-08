const BASE = "http://localhost:7531";

async function createSession(username: string, password: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function main() {
  const admin = await createSession("admin", "admin123");
  const chat = await (
    await fetch(`${BASE}/api/chats`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ title: "diag-409" }),
    })
  ).json();
  const chatId = chat.data.id;

  const messageRes = await (
    await fetch(`${BASE}/api/chats/${chatId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: admin },
      body: JSON.stringify({ content: "explicame OSPF en dos frases", stream: false }),
    })
  ).json();
  const messageId = messageRes.data.id;
  console.log(`✔ chat ${chatId} · mensaje ${messageId}`);

  const liveRetry = fetch(`${BASE}/api/chats/${chatId}/messages/${messageId}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({}),
  });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const conflictRes = await fetch(`${BASE}/api/chats/${chatId}/messages/${messageId}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({}),
  });
  const body = await conflictRes.json().catch(() => null);
  console.log(
    `✔ reintento con turno en curso → HTTP ${conflictRes.status} code=${body?.code ?? "-"} (esperado 409 TURNO_EN_CURSO)`,
  );

  const firstRetry = await liveRetry;
  await firstRetry.text();
  const afterRes = await fetch(`${BASE}/api/chats/${chatId}/messages/${messageId}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({}),
  });
  const body2 = await afterRes.json().catch(() => null);
  console.log(
    `✔ reintento tras completar → HTTP ${afterRes.status} code=${body2?.code ?? "-"} assistantMessageId=${body2?.data?.assistantMessageId ?? "-"} (esperado 409 YA_REINTENTADO)`,
  );

  await fetch(`${BASE}/api/chats/${chatId}`, { method: "DELETE", headers: { Cookie: admin } });
  console.log("✔ limpieza");
}

main().catch((error) => {
  console.error("FALLO:", error?.message ?? error);
  process.exit(1);
});
