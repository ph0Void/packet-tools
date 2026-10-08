import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";

const createdUsers: string[] = [];
const createdDocIds: string[] = [];
afterAll(async () => {
  const bearer = await adminBearer();
  for (const id of createdDocIds) await publicApi().delete(`/api/data/${id}`).set("Authorization", bearer).catch(() => undefined);
  for (const username of createdUsers) await removeTestUser(username);
});

describe("Base de conocimientos /api/data", () => {
  it("ADMIN sube un .txt, lo lista, lo previsualiza inline y lo elimina", async () => {
    const bearer = await adminBearer();
    const content = `# Manual de prueba\nshow ip route\nshow vlan brief\n${"detalle ".repeat(200)}`;
    const tmpFile = path.join(os.tmpdir(), `manual_${Date.now()}.txt`);
    await fs.writeFile(tmpFile, content, "utf8");

    const uploaded = await publicApi().post("/api/data").set("Authorization", bearer)
      .field("title", "Manual de prueba")
      .attach("file", tmpFile);
    await fs.rm(tmpFile, { force: true });

    expect(uploaded.status).toBe(201);
    const docId = uploaded.body.data.id;
    createdDocIds.push(docId);
    expect(uploaded.body.data.fileUrl).toContain("uploads/documents");

    const list = await publicApi().get("/api/data").set("Authorization", bearer);
    expect(list.status).toBe(200);
    const found = (list.body.data ?? []).find((doc: any) => doc.id === docId);
    expect(found?.title).toBe("Manual de prueba");

    expect(found?.content).toBeUndefined();

    const preview = await publicApi().get(`/api/data/${docId}/file`).set("Authorization", bearer);
    expect(preview.status).toBe(200);
    expect(preview.headers["content-type"]).toContain("text/plain");
    expect(preview.headers["content-disposition"]).toContain("inline");
    expect(preview.text).toContain("show vlan brief");


    const viewer = await createTestUser("USER");
    createdUsers.push(viewer.username);
    const viewerLogin = await publicApi().post("/api/auth/login").send(viewer);
    const viewerCookie = (viewerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const viewerPreview = await publicApi().get(`/api/data/${docId}/file`).set("Cookie", viewerCookie);
    expect(viewerPreview.status).toBe(200);


    const forbiddenDelete = await publicApi().delete(`/api/data/${docId}`).set("Cookie", viewerCookie);
    expect(forbiddenDelete.status).toBe(403);


    const badFile = path.join(os.tmpdir(), `virus_${Date.now()}.exe`);
    await fs.writeFile(badFile, "MZ...");
    const rejected = await publicApi().post("/api/data").set("Authorization", bearer).attach("file", badFile);
    await fs.rm(badFile, { force: true });
    expect(rejected.status).toBe(400);
  });
});
