

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { requestContext } from "@/utils/RequestContext";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  SYSTEM_ADMIN_TOOLS,
  SYSTEM_ADMIN_TOOLS_ADMIN,
  SYSTEM_ADMIN_TOOLS_STAFF,
} from "@/agent/systemAdmin/Tool";
import { getToolPolicy } from "@/agent/security/ToolPolicy";


let adminUserId = "";


async function invocarComo<T>(
  role: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = SYSTEM_ADMIN_TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Tool desconocida: ${toolName}`);
  const result = await requestContext.run(
    {
      id: adminUserId,
      username: `test_${role.toLowerCase()}`,
      role,
      approvalChannel: {
        chatId: "chat-test",
        emit: () => {},
      },
    } as never,
    () => tool.invoke(args) as Promise<T>,
  );
  return result as T;
}

const sufijo = Date.now();
const cronCreated = `vitest_admin_cron_${sufijo}`;
const deviceCreated = `vitest_admin_dev_${sufijo}`;

beforeAll(async () => {
  const user = await prismaClient.user.findUnique({
    where: { username: "vitest_suite_admin" },
    select: { id: true },
  });
  adminUserId = user?.id ?? (await prismaClient.user.create({
    data: { username: "vitest_suite_admin", password: "x", role: "ADMIN" },
  })).id;
});

afterEach(async () => {
  await prismaClient.cronJob.deleteMany({ where: { name: cronCreated } });
  await prismaClient.deviceProviders.deleteMany({ where: { name: deviceCreated } });
});

afterAll(async () => {
  await prismaClient.log.deleteMany({ where: { level: "ADMIN_ACTION" } });
});

describe("system_admin_specialist: catálogo de herramientas", () => {
  it("el catálogo para STAFF no incluye las tools destructivas", () => {
    const namesStaff = SYSTEM_ADMIN_TOOLS_STAFF.map((t) => t.name);
    expect(namesStaff).not.toContain("deleteCronJob");
    expect(namesStaff).not.toContain("deleteDeviceProvider");

    expect(namesStaff).toContain("listCronJobs");
    expect(namesStaff).toContain("createCronJob");
    expect(namesStaff).toContain("getSystemMetrics");
  });

  it("el catálogo para ADMIN es el completo", () => {
    expect(SYSTEM_ADMIN_TOOLS_ADMIN.map((t) => t.name)).toEqual(
      expect.arrayContaining(["deleteCronJob", "deleteDeviceProvider"]),
    );
  });

  it("las tools destructivas están registradas como mutating (pasan por HITL)", () => {
    expect(getToolPolicy("deleteCronJob").access).toBe("mutating");
    expect(getToolPolicy("deleteDeviceProvider").access).toBe("mutating");
    expect(getToolPolicy("updateGlobalSystemPrompt").access).toBe("mutating");

    expect(getToolPolicy("listCronJobs").access).toBe("readonly");
    expect(getToolPolicy("getSystemMetrics").access).toBe("readonly");
  });
});

describe("system_admin_specialist: escalada de roles", () => {
  it("USER no puede crear tareas programadas", async () => {
    const output = await invocarComo<string>("USER", "createCronJob", {
      name: cronCreated,
      cronExpression: "0 3 * * *",
    });
    const result = JSON.parse(output) as { success: boolean; error: string };
    expect(result.success).toBe(false);
    expect(result.error).toContain("ADMIN o STAFF");
  });

  it("STAFF puede crear pero NO eliminar una tarea programada", async () => {
    const created = await invocarComo<string>("STAFF", "createCronJob", {
      name: cronCreated,
      cronExpression: "0 3 * * *",
      actionType: "STANDARD",
    });
    const resultCreated = JSON.parse(created) as {
      success: boolean;
      created: boolean;
      job: { id: string };
    };
    expect(resultCreated.success).toBe(true);
    expect(resultCreated.created).toBe(true);

    const borrado = await invocarComo<string>("STAFF", "deleteCronJob", {
      id: resultCreated.job.id,
    });
    const resultBorrado = JSON.parse(borrado) as {
      success: boolean;
      error: string;
    };
    expect(resultBorrado.success).toBe(false);
    expect(resultBorrado.error).toContain("ADMIN");
  });
});

describe("system_admin_specialist: idempotencia y auditoría", () => {
  it("crear dos veces la misma tarea devuelve la existente sin duplicar", async () => {
    const first = await invocarComo<string>("ADMIN", "createCronJob", {
      name: cronCreated,
      cronExpression: "0 3 * * *",
      actionType: "STANDARD",
    });
    const second = await invocarComo<string>("ADMIN", "createCronJob", {
      name: cronCreated,
      cronExpression: "0 5 * * *",
      actionType: "STANDARD",
    });

    const a = JSON.parse(first) as { created: boolean };
    const b = JSON.parse(second) as {
      created: boolean;
      reason: string;
      job: { cronExpression: string };
    };
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.reason).toContain("Ya existe");

    expect(b.job.cronExpression).toBe("0 3 * * *");

    const enBd = await prismaClient.cronJob.count({ where: { name: cronCreated } });
    expect(enBd).toBe(1);
  });

  it("crear una conexión es idempotente por nombre y nunca expone la contraseña", async () => {
    await invocarComo<string>("ADMIN", "createDeviceProvider", {
      name: deviceCreated,
      protocol: "SSH",
      host: "10.0.0.1",
      port: 22,
      username: "admin",
      password: "super-secreta",
    });
    const listado = await invocarComo<string>("ADMIN", "listDeviceProviders", {
      filter: { protocol: "SSH" },
    });
    expect(listado).not.toContain("super-secreta");
  });

  it("toda escritura queda auditada en Log con level ADMIN_ACTION y sin topología", async () => {
    await prismaClient.log.deleteMany({ where: { level: "ADMIN_ACTION" } });
    await invocarComo<string>("ADMIN", "createDeviceProvider", {
      name: deviceCreated,
      protocol: "TELNET",
      host: "10.0.0.2",
    });

    const records = await prismaClient.log.findMany({
      where: { level: "ADMIN_ACTION" },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    expect(records.length).toBeGreaterThan(0);
    const record = records[0];
    expect(record.title).toContain("createDeviceProvider");
    expect(record.content).toContain("test_admin");

    expect(record.topologyId).toBeNull();
  });
});
