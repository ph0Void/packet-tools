import { afterAll, describe, expect, it } from "vitest";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { cronExecutorService } from "@/service/CronExecutorService";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";

const createdUsers: string[] = [];
const createdJobIds: string[] = [];
afterAll(async () => {
  const bearer = await adminBearer();
  for (const id of createdJobIds) await publicApi().delete(`/api/jobs/${id}`).set("Authorization", bearer).catch(() => undefined);
  for (const username of createdUsers) await removeTestUser(username);
});

describe("Tareas programadas /api/jobs", () => {
  it("USER lista trabajos pero no puede crearlos", async () => {
    const viewer = await createTestUser("USER");
    createdUsers.push(viewer.username);
    const viewerLogin = await publicApi().post("/api/auth/login").send(viewer);
    const viewerCookie = (viewerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const list = await publicApi().get("/api/jobs").set("Cookie", viewerCookie);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);

    const forbidden = await publicApi().post("/api/jobs").set("Cookie", viewerCookie)
      .send({ name: "hack", schedule: "0 2 * * *", type: "INTELLIGENCE" });
    expect(forbidden.status).toBe(403);
  });

  it("ADMIN crea un job tipo INTELLIGENCE (mapea a INTELLIGENT), lo actualiza y lo elimina", async () => {
    const bearer = await adminBearer();
    const created = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({
        name: `Auditoría nocturna ${Date.now()}`,
        type: "INTELLIGENCE",
        schedule: "0 2 * * *",
        config: { deviceId: 1, command: "show running-config" },
        enabled: true,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.actionType).toBe("INTELLIGENT");
    expect(created.body.data.cronExpression).toBe("0 2 * * *");
    expect(created.body.data.isActive).toBe(true);
    const jobId = created.body.data.id;
    createdJobIds.push(jobId);


    expect(created.body.data.payload ?? "").toContain("show running-config");

    const updated = await publicApi().put(`/api/jobs/${jobId}`).set("Authorization", bearer)
      .send({ name: "Auditoría renombrada", enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Auditoría renombrada");
    expect(updated.body.data.isActive).toBe(false);

    const detail = await publicApi().get(`/api/jobs/${jobId}`).set("Authorization", await adminBearer());
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(jobId);
  });

  it("rechaza creación sin nombre (400)", async () => {
    const bearer = await adminBearer();
    const invalid = await publicApi().post("/api/jobs").set("Authorization", bearer).send({ schedule: "* * * * *" });
    expect(invalid.status).toBe(400);
  });

  it("ADMIN crea un job de ejecución única con scheduledAt futuro", async () => {
    const bearer = await adminBearer();
    const scheduledAt = new Date(Date.now() + 3600_000).toISOString();
    const created = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Tarea única ${Date.now()}`, scheduledAt });
    expect(created.status).toBe(201);
    createdJobIds.push(created.body.data.id);

    expect(created.body.data.scheduledAt).not.toBeNull();
    expect(created.body.data.cronExpression).toBeNull();
    expect(new Date(created.body.data.nextRun).toISOString()).toBe(scheduledAt);
    expect(created.body.data.isActive).toBe(true);
    expect(created.body.data.status).toBe("PENDING");
  });

  it("rechaza un scheduledAt en el pasado (400)", async () => {
    const bearer = await adminBearer();
    const past = new Date(Date.now() - 3600_000).toISOString();
    const invalid = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Tarea vencida ${Date.now()}`, scheduledAt: past });
    expect(invalid.status).toBe(400);
    expect(JSON.stringify(invalid.body)).toContain("La fecha de ejecución debe ser futura.");
  });

  it("rechaza un scheduledAt nulo explícito (400)", async () => {
    const bearer = await adminBearer();
    const invalid = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Tarea nula ${Date.now()}`, scheduledAt: null });
    expect(invalid.status).toBe(400);
  });

  it("una tarea única vencida se cierra tras ejecutarse (y un STANDARD sin dispositivo falla de verdad)", async () => {
    const bearer = await adminBearer();
    const created = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Cierre única ${Date.now()}`, scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id;
    createdJobIds.push(jobId);


    await prismaClient.cronJob.update({
      where: { id: jobId },
      data: { scheduledAt: new Date(Date.now() - 60_000), nextRun: new Date(Date.now() - 60_000) },
    });

    const result = await cronExecutorService.executeJob(jobId);

    expect(result.ejecutado).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("STANDARD sin comandos en payload");

    const detail = await publicApi().get(`/api/jobs/${jobId}`).set("Authorization", bearer);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("FAILED");

    expect(detail.body.data.isActive).toBe(false);
    expect(detail.body.data.nextRun).toBeNull();
  });

  it("Ejecutar Ahora sobre una tarea única la ejecuta y la deja cerrada", async () => {
    const bearer = await adminBearer();
    const created = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Manual única ${Date.now()}`, scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id;
    createdJobIds.push(jobId);

    const run = await publicApi().post(`/api/jobs/${jobId}/run`).set("Authorization", bearer);
    expect(run.status).toBe(200);
    expect(run.body.message).toBe("Trabajo ejecutado");

    expect(run.body.data.jobId).toBe(jobId);
    expect(run.body.data.ejecutado).toBe(true);
    expect(run.body.data.ok).toBe(false);
    expect(typeof run.body.data.duracionMs).toBe("number");


    const detail = await publicApi().get(`/api/jobs/${jobId}`).set("Authorization", bearer);
    expect(detail.status).toBe(200);
    expect(detail.body.data.isActive).toBe(false);
    expect(detail.body.data.nextRun).toBeNull();
  });

  it("PUT con solo scheduledAt actualiza nextRun y mantiene el resto", async () => {
    const bearer = await adminBearer();
    const created = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Reprogramable ${Date.now()}`, schedule: "0 2 * * *", config: { deviceId: 1 } });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id;
    createdJobIds.push(jobId);

    const scheduledAt = new Date(Date.now() + 7200_000).toISOString();
    const updated = await publicApi().put(`/api/jobs/${jobId}`).set("Authorization", bearer).send({ scheduledAt });
    expect(updated.status).toBe(200);
    expect(updated.body.data.scheduledAt).not.toBeNull();
    expect(updated.body.data.cronExpression).toBeNull();
    expect(new Date(updated.body.data.nextRun).toISOString()).toBe(scheduledAt);
    expect(updated.body.data.status).toBe("PENDING");
  });

  it("PUT parcial enabled=false sobre un job legacy conserva su cron", async () => {
    const bearer = await adminBearer();
    const created = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Legacy ${Date.now()}`, schedule: "0 2 * * *" });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id;
    createdJobIds.push(jobId);

    const updated = await publicApi().put(`/api/jobs/${jobId}`).set("Authorization", bearer).send({ enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.data.cronExpression).toBe("0 2 * * *");
    expect(updated.body.data.isActive).toBe(false);
  });

  it("ejecutar job manualmente: ADMIN lo ejecuta (y rearma), USER no puede y job inexistente da 404", async () => {
    const bearer = await adminBearer();
    const created = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Job manual ${Date.now()}`, schedule: "0 3 * * *", enabled: false });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id;
    createdJobIds.push(jobId);

    const run = await publicApi().post(`/api/jobs/${jobId}/run`).set("Authorization", bearer);
    expect(run.status).toBe(200);
    expect(run.body.message).toBe("Trabajo ejecutado");

    expect(run.body.data.jobId).toBe(jobId);
    expect(run.body.data.ejecutado).toBe(true);
    expect(typeof run.body.data.ok).toBe("boolean");
    expect(typeof run.body.data.duracionMs).toBe("number");
    expect(run.body.data.status).toBe("PENDING");
    expect(run.body.data.isActive).toBe(true);

    const detail = await publicApi().get(`/api/jobs/${jobId}`).set("Authorization", bearer);
    expect(detail.status).toBe(200);
    expect(detail.body.data.status).toBe("PENDING");
    expect(detail.body.data.isActive).toBe(true);

    const missing = await publicApi().post("/api/jobs/no-existe/run").set("Authorization", bearer);
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe("Trabajo no encontrado");

    const viewer = await createTestUser("USER");
    createdUsers.push(viewer.username);
    const viewerLogin = await publicApi().post("/api/auth/login").send(viewer);
    const viewerCookie = (viewerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const forbidden = await publicApi().post(`/api/jobs/${jobId}/run`).set("Cookie", viewerCookie);
    expect(forbidden.status).toBe(403);
  });

  it("USER solo ve sus propias automatizaciones (ADMIN y STAFF ven todas)", async () => {
    const bearer = await adminBearer();
    const ofAdmin = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Aislamiento admin ${Date.now()}`, schedule: "0 2 * * *" });
    expect(ofAdmin.status).toBe(201);
    const adminJobId = ofAdmin.body.data.id;
    createdJobIds.push(adminJobId);

    const viewer = await createTestUser("USER");
    createdUsers.push(viewer.username);
    const viewerLogin = await publicApi().post("/api/auth/login").send(viewer);
    const viewerCookie = (viewerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const viewerRow = await prismaClient.user.findUnique({
      where: { username: viewer.username },
      select: { id: true },
    });


    const ofViewer = await prismaClient.cronJob.create({
      data: { name: `Aislamiento user ${Date.now()}`, cronExpression: "0 4 * * *", userId: viewerRow!.id },
    });
    createdJobIds.push(ofViewer.id);

    const list = await publicApi().get("/api/jobs").set("Cookie", viewerCookie);
    expect(list.status).toBe(200);
    const ids = (list.body.data ?? []).map((job: { id: string }) => job.id);
    expect(ids).toContain(ofViewer.id);
    expect(ids).not.toContain(adminJobId);


    const detail = await publicApi().get(`/api/jobs/${adminJobId}`).set("Cookie", viewerCookie);
    expect(detail.status).toBe(404);

    const listAdmin = await publicApi().get("/api/jobs").set("Authorization", bearer);
    expect((listAdmin.body.data ?? []).map((job: { id: string }) => job.id)).toContain(adminJobId);
  });

  it("GET /api/jobs/scheduler muestra qué automatizaciones quedan armadas", async () => {
    const bearer = await adminBearer();
    const scheduledAt = new Date(Date.now() + 5400_000).toISOString();
    const created = await publicApi().post("/api/jobs").set("Authorization", bearer)
      .send({ name: `Armada ${Date.now()}`, scheduledAt });
    expect(created.status).toBe(201);
    const jobId = created.body.data.id;
    createdJobIds.push(jobId);

    const status = await publicApi().get("/api/jobs/scheduler").set("Authorization", bearer);
    expect(status.status).toBe(200);
    const row = (status.body.data ?? []).find((item: { id: string }) => item.id === jobId);

    expect(row).toBeTruthy();
    expect(row.name).toContain("Armada");
    expect(row.activa).toBe(true);
    expect(row.enEjecucion).toBe(false);
    expect(row.proximaEjecucion).toBe(scheduledAt);


    const viewer = await createTestUser("USER");
    createdUsers.push(viewer.username);
    const viewerLogin = await publicApi().post("/api/auth/login").send(viewer);
    const viewerCookie = (viewerLogin.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const forbidden = await publicApi().get("/api/jobs/scheduler").set("Cookie", viewerCookie);
    expect(forbidden.status).toBe(403);
  });
});
