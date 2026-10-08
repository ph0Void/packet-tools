const BASE = "http://localhost:7531";

async function createSession(username: string, password: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`login ${username} → ${response.status}`);
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}${url}`, init);
  let body: any = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const buildPost = (cookie: string, url: string, payload: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify(payload),
});

const buildDelete = (cookie: string, url: string): RequestInit => ({ method: "DELETE", headers: { Cookie: cookie } });

async function main() {
  const admin = await createSession("admin", "admin123");

  const chat = await fetchJson("/api/chats", buildPost(admin, "/api/chats", { title: "diag-retry" }));
  const chatId = chat.body.data.id;
  console.log(`✔ chat ${chatId}`);

  const messageRes = await fetchJson(
    `/api/chats/${chatId}/messages`,
    buildPost(admin, `/api/chats/${chatId}/messages`, { content: "hola para el reintento", stream: false }),
  );
  const messageId = messageRes.body.data.id;
  console.log(`✔ mensaje de usuario ${messageId}`);

  const retry1 = await fetch(`${BASE}/api/chats/${chatId}/messages/${messageId}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: admin },
    body: JSON.stringify({}),
  });
  console.log(`→ reintento 1: HTTP ${retry1.status} ${retry1.headers.get("content-type")}`);
  await retry1.text();

  const missingRes = await fetchJson(
    `/api/chats/${chatId}/messages/no-existe-xyz/retry`,
    buildPost(admin, `/api/chats/${chatId}/messages/no-existe-xyz/retry`, {}),
  );
  console.log(`✔ mensaje inexistente → ${missingRes.status} (esperado 404)`);

  const messagesPage = await fetchJson(`/api/chats/${chatId}/messages?limit=1`, {
    headers: { Cookie: admin },
  });
  console.log(
    `✔ paginación mensajes: ${messagesPage.body.data.length} devueltos, meta=${JSON.stringify(messagesPage.body.meta)}`,
  );
  const chatsPage = await fetchJson(`/api/chats?limit=2`, { headers: { Cookie: admin } });
  const withHistoryCount = Array.isArray(chatsPage.body.data)
    ? chatsPage.body.data.filter((item: any) => Array.isArray(item.messages) && item.messages.length > 0).length
    : -1;
  console.log(
    `✔ paginación chats: ${chatsPage.body.data.length} devueltos, con messages embebidas: ${withHistoryCount} (esperado 0), meta=${JSON.stringify(chatsPage.body.meta)}`,
  );

  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";
  const withAttachmentRes = await fetchJson(
    `/api/chats/${chatId}/messages`,
    buildPost(admin, `/api/chats/${chatId}/messages`, {
      content: "con adjunto",
      stream: false,
      attachments: [{ fileName: "pixel.png", fileType: "IMAGE", fileUrl: `data:image/png;base64,${png}`, mimeType: "image/png" }],
    }),
  );
  const attachmentId = withAttachmentRes.body.data.attachments?.[0]?.id;
  const fileUrl = withAttachmentRes.body.data.attachments?.[0]?.fileUrl;
  const sha = withAttachmentRes.body.data.attachments?.[0]?.sha256;
  console.log(
    `✔ adjunto: id=${attachmentId} fileUrl=${fileUrl === null ? "null (correcto)" : JSON.stringify(fileUrl)?.slice(0, 40)} sha256=${String(sha).slice(0, 16)}…`,
  );

  const servedRes = await fetch(`${BASE}/api/chats/attachments/${attachmentId}`, { headers: { Cookie: admin } });
  console.log(
    `✔ servir adjunto: HTTP ${servedRes.status} type=${servedRes.headers.get("content-type")} bytes=${(await servedRes.arrayBuffer()).byteLength}`,
  );

  const otherRes = await fetch(`${BASE}/api/chats/attachments/${attachmentId}`, { headers: { Cookie: "packet-tools-cookie=invalido" } });
  console.log(`✔ adjunto con cookie inválida: HTTP ${otherRes.status}`);

  const notFoundRes = await fetch(`${BASE}/api/chats/attachments/no-existe`, { headers: { Cookie: admin } });
  console.log(`✔ adjunto inexistente: HTTP ${notFoundRes.status} (esperado 404)`);

  const deletedRes = await fetchJson(`/api/chats/${chatId}`, buildDelete(admin, `/api/chats/${chatId}`));
  console.log(`✔ limpieza del chat: HTTP ${deletedRes.status}`);
}

main().catch((error) => {
  console.error("FALLO:", error?.message ?? error);
  process.exit(1);
});
