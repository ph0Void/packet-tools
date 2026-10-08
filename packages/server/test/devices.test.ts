import { afterAll, describe, expect, it } from "vitest";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";

const createdUsers: string[] = [];
const createdDeviceIds: string[] = [];
afterAll(async () => {
  const bearer = await adminBearer();
  for (const id of createdDeviceIds) await publicApi().delete(`/api/devices/${id}`).set("Authorization", bearer).catch(() => undefined);
  for (const username of createdUsers) await removeTestUser(username);
});

describe("Dispositivos /api/devices y proveedores /api/providers", () => {
  it("ADMIN crea un dispositivo SSH y USER puede listarlo pero no editarlo", async () => {
    const bearer = await adminBearer();
    const viewer = await createTestUser("USER");
    createdUsers.push(viewer.username);
    const viewerLogin = await publicApi().post("/api/auth/login").send(viewer);
    const viewerCookie = (viewerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const created = await publicApi().post("/api/devices").set("Authorization", bearer)
      .send({ name: `SW_TEST_${Date.now()}`, typeDevice: "CISCO", protocol: "SSH", host: "192.168.1.10", port: 22, username: "admin", password: "cisco123" });
    expect(created.status).toBe(201);
    const deviceId = created.body.data.id;
    createdDeviceIds.push(deviceId);

    const listForViewer = await publicApi().get("/api/devices").set("Cookie", viewerCookie);
    expect(listForViewer.status).toBe(200);
    expect((listForViewer.body.data ?? []).some((item: any) => item.id === deviceId)).toBe(true);

    const forbiddenCreate = await publicApi().post("/api/devices").set("Cookie", viewerCookie)
      .send({ name: "hack", topologyJson: "" });
    expect(forbiddenCreate.status).toBe(403);

    const updated = await publicApi().put(`/api/devices/${deviceId}`).set("Authorization", bearer).send({ status: "ONLINE" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.status).toBe("ONLINE");
  });

  it("/api/providers solo es administrable por ADMIN", async () => {
    const bearer = await adminBearer();
    const staff = await createTestUser("STAFF");
    createdUsers.push(staff.username);
    const staffLogin = await publicApi().post("/api/auth/login").send(staff);
    const staffCookie = (staffLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];


    const forbidden = await publicApi().post("/api/providers").set("Cookie", staffCookie)
      .send({ name: "proveedor_hack", host: "http://localhost" });
    expect(forbidden.status).toBe(403);


    const ok = await publicApi().get("/api/providers").set("Authorization", bearer);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body.data)).toBe(true);
  });
});
