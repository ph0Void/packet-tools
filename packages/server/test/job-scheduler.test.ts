

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import schedule from "node-schedule";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  calcularProximaEjecucion,
  cancelarJob,
  detenerProgramador,
  ejecutarJobAhora,
  ejecutarYReplanificar,
  iniciarProgramador,
  instantaneaProgramador,
  obtenerEnEjecucion,
  programarJob,
  reprogramarJob,
} from "@/service/JobScheduler";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";


const MARKER = "TEST_SCHED";


function temporizadoresArmados(): string[] {
  return Object.keys(schedule.scheduledJobs ?? {}).filter((key) => key.startsWith("cronjob:"));
}


function rowOf(id: string) {
  return instantaneaProgramador().find((row) => row.id === id);
}


function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function waitHasta(
  condicion: () => boolean | Promise<boolean>,
  opciones: { descripcion: string; timeoutMs?: number; intervaloMs?: number },
): Promise<void> {
  const timeoutMs = opciones.timeoutMs ?? 5_000;
  const intervaloMs = opciones.intervaloMs ?? 30;
  const limit = Date.now() + timeoutMs;
  for (;;) {
    if (await condicion()) return;
    if (Date.now() >= limit) throw new Error(`Se agotó el plazo esperando: ${opciones.descripcion}`);
    await wait(intervaloMs);
  }
}






const idsCreated = new Set<string>();

const usersCreated: string[] = [];

let cronJobsCreated = 0;
let logsBorrados = 0;

let counter = 0;

interface DataJob {
  cronExpression?: string | null;
  scheduledAt?: Date | null;
  isActive?: boolean;
  nextRun?: Date | null;
  userId?: string | null;
}



async function createJob(data: DataJob = {}): Promise<{ id: string; name: string }> {
  counter += 1;
  const name = `${MARKER}_${Date.now()}_${counter}`;
  const job = await prismaClient.cronJob.create({
    data: {
      name,
      actionType: "STANDARD",
      cronExpression: data.cronExpression ?? null,
      scheduledAt: data.scheduledAt ?? null,
      isActive: data.isActive ?? true,
      nextRun: data.nextRun ?? null,
      ...(data.userId ? { userId: data.userId } : {}),
    },
  });
  idsCreated.add(job.id);
  cronJobsCreated += 1;
  return { id: job.id, name: job.name };
}


function readJob(id: string) {
  return prismaClient.cronJob.findUnique({ where: { id } });
}



function logsOfJob(name: string) {
  return prismaClient.log.findMany({
    where: { OR: [{ title: { contains: name } }, { content: { contains: name } }] },
    orderBy: { createdAt: "asc" },
  });
}


async function clearBaseOfData(): Promise<void> {
  if (idsCreated.size > 0) {
    await prismaClient.cronJob.deleteMany({ where: { id: { in: [...idsCreated] } } });
    idsCreated.clear();
  }
  const { count } = await prismaClient.log.deleteMany({
    where: { OR: [{ title: { contains: MARKER } }, { content: { contains: MARKER } }] },
  });
  logsBorrados += count;
}


function etiquetaOf(info: { testPath?: unknown; task?: { name?: string } }): string {
  const route = Array.isArray(info.testPath) ? info.testPath.join(" > ") : String(info.testPath ?? "");
  return `${route}${info.task?.name ? ` :: ${info.task.name}` : ""}`;
}





beforeEach(() => {
  
  detenerProgramador();
  expect(instantaneaProgramador(), "el planificador debe arrancar vacío").toEqual([]);
});

afterEach(async (info) => {
  
  
  
  detenerProgramador();
  const vivos = instantaneaProgramador();
  await clearBaseOfData();
  expect(vivos, `temporizadores vivos al terminar: ${etiquetaOf(info)}`).toEqual([]);
});

afterAll(async () => {
  detenerProgramador();
  expect(instantaneaProgramador(), "el planificador debe quedar apagado al cerrar la suite").toEqual([]);
  await clearBaseOfData();
  for (const username of usersCreated) await removeTestUser(username);
  console.log(
    `[limpieza] cronJobs creados: ${cronJobsCreated} | logs de ejecución borrados: ${logsBorrados} | ` +
      `temporizadores vivos al final: ${instantaneaProgramador().length}`,
  );
});





describe("calcularProximaEjecucion: única fuente de verdad de «cuándo toca»", () => {
  it("recurrente: devuelve la siguiente frontera de 5 minutos, siempre futura", () => {
    const before = Date.now();
    const fecha = calcularProximaEjecucion({
      id: "job-cron",
      name: "Cada 5 minutos",
      cronExpression: "*/5 * * * *",
      scheduledAt: null,
      isActive: true,
    });

    expect(fecha).toBeInstanceOf(Date);
    const ms = fecha!.getTime();
    expect(ms).toBeGreaterThan(before);

    expect(fecha!.getSeconds()).toBe(0);
    expect(fecha!.getMilliseconds()).toBe(0);
    expect(fecha!.getMinutes() % 5).toBe(0);

    expect(ms - before).toBeLessThanOrEqual(5 * 60_000);
  });

  it("ejecución única: devuelve exactamente su scheduledAt", () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    const fecha = calcularProximaEjecucion({
      id: "job-una-vez",
      name: "Una sola vez",
      cronExpression: null,
      scheduledAt,
      isActive: true,
    });

    expect(fecha).not.toBeNull();
    expect(fecha!.getTime()).toBe(scheduledAt.getTime());
  });

  it("expresión cron inválida: devuelve null y NO lanza", () => {
    const fecha = calcularProximaEjecucion({
      id: "job-roto",
      name: "Cron inválido",
      cronExpression: "no es cron",
      scheduledAt: null,
      isActive: true,
    });
    expect(fecha).toBeNull();
  });

  it("sin ninguna programación: devuelve null", () => {
    expect(
      calcularProximaEjecucion({
        id: "job-sin-fecha",
        name: "Sin programación",
        cronExpression: null,
        scheduledAt: null,
        isActive: true,
      }),
    ).toBeNull();


    expect(
      calcularProximaEjecucion({
        id: "job-blanco",
        name: "Expresión en blanco",
        cronExpression: "   ",
        scheduledAt: null,
        isActive: true,
      }),
    ).toBeNull();
  });

  it("scheduledAt ilegible: devuelve null y NO lanza", () => {
    const fecha = calcularProximaEjecucion({
      id: "job-fecha-rota",
      name: "Fecha ilegible",
      cronExpression: null,
      scheduledAt: new Date("no es una fecha"),
      isActive: true,
    });
    expect(fecha).toBeNull();
  });

  it("la recurrente cuenta desde ahora: dos llamadas seguidas no se retrasan", () => {
    const job = {
      id: "job-cron",
      name: "Cada 5 minutos",
      cronExpression: "*/5 * * * *",
      scheduledAt: null,
      isActive: true,
    };
    const first = calcularProximaEjecucion(job)!;
    const second = calcularProximaEjecucion(job)!;


    expect(second.getTime()).toBeGreaterThanOrEqual(first.getTime());
    expect(second.getTime() - first.getTime()).toBeLessThan(5 * 60_000);
    expect(second.getTime()).toBeGreaterThan(Date.now());
  });

  it("una recurrente ignora su nextRun vencido: la fecha sale de ahora, no del pasado", () => {
    const nextRunVencido = new Date(Date.now() - 3_600_000);
    const fecha = calcularProximaEjecucion({
      id: "job-vencido",
      name: "Recurrente con espejo vencido",
      cronExpression: "*/5 * * * *",
      scheduledAt: null,
      isActive: true,
      nextRun: nextRunVencido,
    });

    expect(fecha).not.toBeNull();
    expect(fecha!.getTime()).toBeGreaterThan(Date.now());
    expect(fecha!.getTime()).toBeGreaterThan(nextRunVencido.getTime());
  });
});





describe("programarJob / cancelarJob / reprogramarJob", () => {
  it("un job activo con fecha futura queda armado con esa fecha y no en ejecución", async () => {
    const scheduledAt = new Date(Date.now() + 2 * 3_600_000);
    const { id, name } = await createJob({ scheduledAt, isActive: true });

    await programarJob(id);

    const row = rowOf(id);
    expect(row).toBeDefined();
    expect(row!.id).toBe(id);
    expect(row!.name).toBe(name);
    expect(row!.activa).toBe(true);
    expect(row!.enEjecucion).toBe(false);
    expect(row!.proximaEjecucion).toBe(scheduledAt.toISOString());
    expect(obtenerEnEjecucion()).toEqual([]);


    const enBd = await readJob(id);
    expect(enBd!.nextRun!.toISOString()).toBe(scheduledAt.toISOString());
    expect(temporizadoresArmados()).toEqual([`cronjob:${id}`]);
  });

  it("programarJob es idempotente: llamarlo tres veces deja UN solo temporizador", async () => {
    const { id } = await createJob({ scheduledAt: new Date(Date.now() + 2 * 3_600_000) });

    await programarJob(id);
    await programarJob(id);
    await programarJob(id);

    expect(temporizadoresArmados()).toEqual([`cronjob:${id}`]);
    expect(instantaneaProgramador().filter((row) => row.id === id)).toHaveLength(1);
  });

  it("cancelarJob quita el temporizador y dice si había algo que cancelar", async () => {
    const { id } = await createJob({ scheduledAt: new Date(Date.now() + 2 * 3_600_000) });
    await programarJob(id);
    expect(rowOf(id)).toBeDefined();

    expect(cancelarJob(id)).toBe(true);
    expect(rowOf(id)).toBeUndefined();
    expect(temporizadoresArmados()).toEqual([]);


    expect(cancelarJob(id)).toBe(false);
  });

  it("reprogramarJob cancela y vuelve a armar desde cero con la fecha nueva", async () => {
    const { id } = await createJob({ scheduledAt: new Date(Date.now() + 2 * 3_600_000) });
    await programarJob(id);


    const nueva = new Date(Date.now() + 4 * 3_600_000);
    await prismaClient.cronJob.update({ where: { id }, data: { scheduledAt: nueva, nextRun: nueva } });
    await reprogramarJob(id);

    expect(temporizadoresArmados()).toEqual([`cronjob:${id}`]);
    expect(rowOf(id)!.proximaEjecucion).toBe(nueva.toISOString());
  });

  it("un job inactivo no se arma", async () => {
    const { id } = await createJob({ scheduledAt: new Date(Date.now() + 3_600_000), isActive: false });

    await programarJob(id);

    expect(rowOf(id)).toBeUndefined();
    expect(temporizadoresArmados()).toEqual([]);
  });

  it("un job con nextRun vencido no se arma en un temporizador imposible", async () => {
    const vencido = new Date(Date.now() - 60_000);
    const { id } = await createJob({ scheduledAt: vencido, nextRun: vencido, isActive: true });

    await programarJob(id);


    expect(rowOf(id)).toBeUndefined();
    expect(temporizadoresArmados()).toEqual([]);
    expect(obtenerEnEjecucion()).not.toContain(id);
    const enBd = await readJob(id);
    expect(enBd!.status).toBe("PENDING");
    expect(enBd!.lastRun).toBeNull();
  });

  it("una recurrente con nextRun vencido sí se rearma, con la siguiente ocurrencia", async () => {
    const { id } = await createJob({
      cronExpression: "*/5 * * * *",
      isActive: true,
      nextRun: new Date(Date.now() - 3_600_000),
    });

    await programarJob(id);

    const row = rowOf(id);
    expect(row).toBeDefined();
    expect(new Date(row!.proximaEjecucion!).getTime()).toBeGreaterThan(Date.now());

    const enBd = await readJob(id);
    expect(enBd!.nextRun!.toISOString()).toBe(row!.proximaEjecucion);
  });
});





describe("Disparo real del temporizador de un disparo", () => {
  it("una ejecución única dispara sola a su hora, deja rastro y se cierra", async () => {
    const scheduledAt = new Date(Date.now() + 150);
    const { id, name } = await createJob({ scheduledAt, nextRun: scheduledAt, isActive: true });

    await programarJob(id);
    expect(rowOf(id)!.proximaEjecucion).toBe(scheduledAt.toISOString());


    await waitHasta(
      async () => {
        const tras = await readJob(id);
        if (tras!.status !== "FAILED") return false;
        return (await logsOfJob(name)).length > 0;
      },
      { descripcion: "el disparo del temporizador y su traza en Log", timeoutMs: 10_000 },
    );

    const tras = await readJob(id);
    expect(tras!.status).toBe("FAILED");
    expect(tras!.lastRun).not.toBeNull();

    const logs = await logsOfJob(name);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.some((log) => log.level === "CRON_EXECUTION" || log.level === "ERROR")).toBe(true);
    expect(logs.some((log) => log.content.includes(id))).toBe(true);


    expect(tras!.isActive).toBe(false);
    expect(tras!.nextRun).toBeNull();


    await waitHasta(() => rowOf(id) === undefined, {
      descripcion: "que la ejecución única desaparezca de la instantánea",
      timeoutMs: 5_000,
    });
    expect(temporizadoresArmados()).toEqual([]);
    expect(obtenerEnEjecucion()).toEqual([]);
  });

  it("una recurrente dispara, deja rastro y se rearma con un nextRun futuro", async () => {

    const { id, name } = await createJob({ cronExpression: "* * * * * *", isActive: true });

    await programarJob(id);
    const firstFecha = rowOf(id)!.proximaEjecucion!;
    expect(new Date(firstFecha).getTime()).toBeGreaterThan(Date.now());

    try {

      await waitHasta(
        async () => {
          const tras = await readJob(id);
          if (tras!.lastRun === null || tras!.status !== "PENDING") return false;
          const row = rowOf(id);
          return row !== undefined && row.proximaEjecucion !== firstFecha;
        },
        { descripcion: "el rearme de la recurrente tras su disparo", timeoutMs: 15_000 },
      );

      const tras = await readJob(id);

      expect(tras!.isActive).toBe(true);
      expect(tras!.status).toBe("PENDING");
      expect(tras!.lastRun).not.toBeNull();
      expect(tras!.nextRun!.getTime()).toBeGreaterThan(Date.now());

      const row = rowOf(id)!;
      expect(row.activa).toBe(true);
      expect(row.enEjecucion).toBe(false);

      expect(row.proximaEjecucion).toBe(tras!.nextRun!.toISOString());
      expect(new Date(row.proximaEjecucion!).getTime()).toBeGreaterThan(new Date(firstFecha).getTime());

      const logs = await logsOfJob(name);
      expect(logs.length).toBeGreaterThanOrEqual(1);
      expect(logs.some((log) => log.level === "CRON_EXECUTION" || log.level === "ERROR")).toBe(true);
    } finally {
      await prismaClient.cronJob.update({ where: { id }, data: { isActive: false } }).catch(() => undefined);
      detenerProgramador();
    }
  });
});





describe("iniciarProgramador: recuperación tras apagado", () => {
  it("arma los jobs con nextRun futuro SIN ejecutarlos y nunca lanza", async () => {
    const scheduledAt = new Date(Date.now() + 2 * 3_600_000);
    const { id } = await createJob({ scheduledAt, nextRun: scheduledAt, isActive: true });

    await expect(iniciarProgramador()).resolves.toBeUndefined();

    const row = rowOf(id);
    expect(row).toBeDefined();
    expect(row!.proximaEjecucion).toBe(scheduledAt.toISOString());
    expect(row!.enEjecucion).toBe(false);


    const tras = await readJob(id);
    expect(tras!.status).toBe("PENDING");
    expect(tras!.lastRun).toBeNull();
    expect(tras!.isActive).toBe(true);
  });

  it("recupera una ejecución única vencida: la ejecuta UNA vez y la deja cerrada", async () => {
    const vencido = new Date(Date.now() - 60_000);
    const { id, name } = await createJob({ scheduledAt: vencido, nextRun: vencido, isActive: true });

    await expect(iniciarProgramador()).resolves.toBeUndefined();


    await waitHasta(
      async () => {
        const tras = await readJob(id);
        return tras!.isActive === false && tras!.lastRun !== null && obtenerEnEjecucion().length === 0;
      },
      { descripcion: "la recuperación de la ejecución única vencida", timeoutMs: 15_000 },
    );

    const tras = await readJob(id);
    expect(tras!.status).toBe("FAILED");
    expect(tras!.isActive).toBe(false);
    expect(tras!.nextRun).toBeNull();

    expect(await logsOfJob(name)).toHaveLength(1);
    expect(rowOf(id)).toBeUndefined();
  });

  it("recupera una recurrente vencida y la rearma con un nextRun futuro", async () => {
    const { id, name } = await createJob({
      cronExpression: "*/5 * * * *",
      isActive: true,
      nextRun: new Date(Date.now() - 60_000),
    });

    await expect(iniciarProgramador()).resolves.toBeUndefined();

    await waitHasta(
      async () => {
        const tras = await readJob(id);
        const tieneFuturo = (tras!.nextRun?.getTime() ?? 0) > Date.now();
        return tras!.lastRun !== null && tras!.status === "PENDING" && tieneFuturo && obtenerEnEjecucion().length === 0;
      },
      { descripcion: "el rearme de la recurrente recuperada", timeoutMs: 15_000 },
    );

    const tras = await readJob(id);
    expect(tras!.isActive).toBe(true);
    expect(tras!.status).toBe("PENDING");
    expect(tras!.nextRun!.getTime()).toBeGreaterThan(Date.now());

    const row = rowOf(id);
    expect(row).toBeDefined();
    expect(row!.proximaEjecucion).toBe(tras!.nextRun!.toISOString());
    expect(await logsOfJob(name)).toHaveLength(1);
  });

  it("se puede llamar dos veces seguidas sin lanzar nada", async () => {
    await expect(iniciarProgramador()).resolves.toBeUndefined();
    await expect(iniciarProgramador()).resolves.toBeUndefined();
    expect(instantaneaProgramador()).toEqual([]);
  });
});





describe("Guard de solape: una automatización nunca corre dos veces a la vez", () => {
  it("dos ejecuciones concurrentes del mismo id producen UNA sola ejecución", async () => {
    const scheduledAt = new Date(Date.now() + 3_600_000);
    const { id, name } = await createJob({ scheduledAt, nextRun: scheduledAt, isActive: true });


    const [first, second] = await Promise.all([
      ejecutarYReplanificar(id),
      ejecutarYReplanificar(id),
    ]);

    const results = [first, second].filter((result) => result !== null);
    expect(results).toHaveLength(1);
    expect(results[0]!.jobId).toBe(id);
    expect(results[0]!.ejecutado).toBe(true);


    expect(await logsOfJob(name)).toHaveLength(1);
    expect(obtenerEnEjecucion()).toEqual([]);
  });
});





describe("ejecutarJobAhora", () => {
  it("reactiva un job desactivado, lo ejecuta y devuelve el ResultadoEjecucion", async () => {
    const { id, name } = await createJob({ cronExpression: "*/5 * * * *", isActive: false, nextRun: null });

    const result = await ejecutarJobAhora(id);

    expect(result).not.toBeNull();
    expect(result!.jobId).toBe(id);
    expect(result!.name).toBe(name);
    expect(result!.ejecutado).toBe(true);

    expect(result!.ok).toBe(false);
    expect(result!.error).toContain("STANDARD sin comandos en payload");
    expect(typeof result!.duracionMs).toBe("number");
    expect(result!.duracionMs).toBeGreaterThanOrEqual(0);

    const tras = await readJob(id);
    expect(tras!.isActive).toBe(true);
    expect(tras!.status).toBe("PENDING");
    expect(tras!.nextRun!.getTime()).toBeGreaterThan(Date.now());

    expect(rowOf(id)!.proximaEjecucion).toBe(tras!.nextRun!.toISOString());
    expect(obtenerEnEjecucion()).toEqual([]);
  });

  it("devuelve null si el job no existe (no lanza)", async () => {
    await expect(ejecutarJobAhora("job-que-no-existe")).resolves.toBeNull();
  });
});





describe("detenerProgramador", () => {
  it("vacía la instantánea, cancela todos los temporizadores y es idempotente", async () => {
    const uno = await createJob({ scheduledAt: new Date(Date.now() + 2 * 3_600_000) });
    const other = await createJob({ cronExpression: "*/5 * * * *", isActive: true });
    await programarJob(uno.id);
    await programarJob(other.id);
    expect(temporizadoresArmados()).toHaveLength(2);
    expect(instantaneaProgramador()).toHaveLength(2);

    detenerProgramador();

    expect(instantaneaProgramador()).toEqual([]);
    expect(temporizadoresArmados()).toEqual([]);
    expect(obtenerEnEjecucion()).toEqual([]);


    expect(() => detenerProgramador()).not.toThrow();
    detenerProgramador();
    expect(instantaneaProgramador()).toEqual([]);
  });
});





describe("API del planificador: aislamiento y estado real", () => {
  it("GET /api/jobs: un USER solo ve sus jobs y el ADMIN los ve todos", async () => {
    const bearer = await adminBearer();


    const created = await publicApi()
      .post("/api/jobs")
      .set("Authorization", bearer)
      .send({ name: `${MARKER}_api_${Date.now()}`, schedule: "0 2 * * *", actionType: "STANDARD" });
    expect(created.status).toBe(201);
    const jobOfAdmin = created.body.data.id as string;
    idsCreated.add(jobOfAdmin);
    cronJobsCreated += 1;

    const viewer = await createTestUser("USER");
    usersCreated.push(viewer.username);
    const row = await prismaClient.user.findUnique({
      where: { username: viewer.username },
      select: { id: true },
    });

    const jobOfUser = await createJob({ cronExpression: "0 4 * * *", userId: row!.id });

    const login = await publicApi().post("/api/auth/login").send(viewer);
    const cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];

    const listViewer = await publicApi().get("/api/jobs").set("Cookie", cookie);
    expect(listViewer.status).toBe(200);
    const idsViewer = (listViewer.body.data ?? []).map((job: { id: string }) => job.id);
    expect(idsViewer).toContain(jobOfUser.id);
    expect(idsViewer).not.toContain(jobOfAdmin);


    const detailForeign = await publicApi().get(`/api/jobs/${jobOfAdmin}`).set("Cookie", cookie);
    expect(detailForeign.status).toBe(404);

    const listAdmin = await publicApi().get("/api/jobs").set("Authorization", bearer);
    expect(listAdmin.status).toBe(200);
    const idsAdmin = (listAdmin.body.data ?? []).map((job: { id: string }) => job.id);
    expect(idsAdmin).toContain(jobOfAdmin);
    expect(idsAdmin).toContain(jobOfUser.id);


    expect(rowOf(jobOfAdmin)).toBeDefined();
    const borrado = await publicApi().delete(`/api/jobs/${jobOfAdmin}`).set("Authorization", bearer);
    expect(borrado.status).toBe(200);
    expect(rowOf(jobOfAdmin)).toBeUndefined();
    idsCreated.delete(jobOfAdmin);
  });

  it("GET /api/jobs/scheduler: la forma de la fila, ISO (nunca Date) y 403 para USER", async () => {
    const bearer = await adminBearer();
    const scheduledAt = new Date(Date.now() + 90 * 60_000);
    const { id, name } = await createJob({ scheduledAt, isActive: true });
    await programarJob(id);

    const status = await publicApi().get("/api/jobs/scheduler").set("Authorization", bearer);
    expect(status.status).toBe(200);
    expect(Array.isArray(status.body.data)).toBe(true);

    const row = (status.body.data ?? []).find((item: { id: string }) => item.id === id);
    expect(row).toBeTruthy();

    expect(Object.keys(row).sort()).toEqual(
      ["activa", "enEjecucion", "id", "nombre", "proximaEjecucion"].sort(),
    );
    expect(row.id).toBe(id);
    expect(row.name).toBe(name);
    expect(row.activa).toBe(true);
    expect(row.enEjecucion).toBe(false);

    expect(typeof row.proximaEjecucion).toBe("string");
    expect(row.proximaEjecucion).toBe(scheduledAt.toISOString());
    expect(new Date(row.proximaEjecucion as string).toISOString()).toBe(row.proximaEjecucion);


    for (const item of status.body.data as { proximaEjecucion: unknown }[]) {
      if (item.proximaEjecucion === null) continue;
      expect(typeof item.proximaEjecucion).toBe("string");
      expect(new Date(item.proximaEjecucion as string).toISOString()).toBe(item.proximaEjecucion);
    }


    const viewer = await createTestUser("USER");
    usersCreated.push(viewer.username);
    const login = await publicApi().post("/api/auth/login").send(viewer);
    const cookie = (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
    const prohibido = await publicApi().get("/api/jobs/scheduler").set("Cookie", cookie);
    expect(prohibido.status).toBe(403);


    const borrado = await publicApi().delete(`/api/jobs/${id}`).set("Authorization", bearer);
    expect(borrado.status).toBe(200);
    expect(rowOf(id)).toBeUndefined();
    idsCreated.delete(id);
  });
});
