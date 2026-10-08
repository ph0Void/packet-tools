import { afterAll, describe, expect, it } from "vitest";
import { adminBearer, publicApi } from "./helpers";
import { prismaClient } from "@/prisma/lib/PrismaClient";


const createdModelIds: string[] = [];

afterAll(async () => {
  for (const id of createdModelIds) {
    try {
      await prismaClient.modelProvider.delete({ where: { id } });
    } catch {
      
    }
  }
});


async function createTemporaryProvider(data: { provider: "OLLAMA"; modelName: string; baseUrl?: string; apiKey?: string | null }) {
  const created = await prismaClient.modelProvider.create({
    data: {
      name: `vitest_model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      provider: data.provider,
      modelName: data.modelName,
      typeModel: "CHAT",
      baseUrl: data.baseUrl ?? null,
      apiKey: data.apiKey ?? null,
      isActive: false,
      userPermission: "ADMIN",
    },
  });
  createdModelIds.push(created.id);
  return created;
}

describe("Prueba de conexión de modelos /api/config/models/test", () => {
  it("rechaza la petición sin token con 401", async () => {
    const response = await publicApi().post("/api/config/models/test").send({ provider: "OLLAMA", modelName: "test" });
    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });

  it("responde 400 si falta modelName", async () => {
    const response = await publicApi()
      .post("/api/config/models/test")
      .set("Authorization", await adminBearer())
      .send({ provider: "OLLAMA" });
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message)).toMatch(/modelName/i);
  });

  it("con un id inexistente y sin apiKey responde 404 coherente, sin exigir API Key", async () => {
    const response = await publicApi()
      .post("/api/config/models/test")
      .set("Authorization", await adminBearer())
      .send({ id: "proveedor_inexistente_vitest", provider: "OLLAMA", modelName: "test" });
    expect([400, 404]).toContain(response.status);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message)).not.toMatch(/API Key/i);
  });

  it("con la máscara [configured] usa la apiKey/baseUrl de BD y falla por conexión, no por API Key", async () => {

    const provider = await createTemporaryProvider({ provider: "OLLAMA", modelName: "test", baseUrl: "http://127.0.0.1:1" });

    const response = await publicApi()
      .post("/api/config/models/test")
      .set("Authorization", await adminBearer())
      .send({ id: provider.id, provider: "OLLAMA", modelName: "test", apiKey: "[configured]" });

    expect(response.status).not.toBe(500);
    expect(response.body.success).toBe(false);
    expect(String(response.body.message)).toMatch(/conectar/i);
    expect(String(response.body.message)).not.toMatch(/API Key/i);
  });

  it("no persiste la máscara [configured] al actualizar un proveedor", async () => {
    const provider = await createTemporaryProvider({ provider: "OLLAMA", modelName: "test", apiKey: "clave-real" });

    const response = await publicApi()
      .put(`/api/config/models/${provider.id}`)
      .set("Authorization", await adminBearer())
      .send({ apiKey: "[configured]", modelName: "test-actualizado" });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const stored = await prismaClient.modelProvider.findUnique({ where: { id: provider.id } });
    expect(stored?.apiKey).toBe("clave-real");
    expect(stored?.modelName).toBe("test-actualizado");
  });
});
