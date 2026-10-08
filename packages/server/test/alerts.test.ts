import { afterAll, describe, expect, it } from "vitest";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";

const createdUsers: string[] = [];
let topologyId = "";
afterAll(async () => {
  const bearer = await adminBearer();
  if (topologyId) await publicApi().delete(`/api/topologies/${topologyId}`).set("Authorization", bearer).catch(() => undefined);
  for (const username of createdUsers) await removeTestUser(username);
});

describe("Alertas /api/alerts", () => {
  it("USER crea una alerta y solo ve las suyas; ADMIN ve todas y puede borrar", async () => {
    const bearer = await adminBearer();


    const owner = await createTestUser("USER");
    createdUsers.push(owner.username);
    const ownerLogin = await publicApi().post("/api/auth/login").send(owner);
    const ownerCookie = (ownerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const topology = await publicApi().post("/api/topologies").set("Authorization", bearer)
      .send({ name: `topo_alertas_${Date.now()}`, topologyJson: JSON.stringify({ nodes: [] }) });
    expect(topology.status).toBe(201);
    topologyId = topology.body.data.id;

    const created = await publicApi().post("/api/alerts").set("Cookie", ownerCookie)
      .send({ title: "Alerta de prueba", description: "Enlace caído en el core", severity: "HIGH", topologyId });
    expect(created.status).toBe(201);
    const alertId = created.body.data.id;
    expect(created.body.data.resolved).toBe(false);


    const ownList = await publicApi().get("/api/alerts").set("Cookie", ownerCookie);
    expect(ownList.status).toBe(200);
    expect((ownList.body.data ?? []).some((item: any) => item.id === alertId)).toBe(true);


    const forbiddenUpdate = await publicApi().put(`/api/alerts/${alertId}`).set("Cookie", ownerCookie).send({ resolved: true });
    expect(forbiddenUpdate.status).toBe(403);
    const forbiddenDelete = await publicApi().delete(`/api/alerts/${alertId}`).set("Cookie", ownerCookie);
    expect(forbiddenDelete.status).toBe(403);


    const updated = await publicApi().put(`/api/alerts/${alertId}`).set("Authorization", bearer).send({ resolved: true, severity: "LOW" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.resolved).toBe(true);

    const deleted = await publicApi().delete(`/api/alerts/${alertId}`).set("Authorization", bearer);
    expect(deleted.status).toBe(200);


    const invalid = await publicApi().post("/api/alerts").set("Cookie", ownerCookie).send({ title: "incompleta" });
    expect(invalid.status).toBe(400);
  });
});
