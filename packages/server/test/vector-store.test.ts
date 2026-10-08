import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { vectorStoreService } from "@/service/VectorStoreService";



const token = `pruebavectorial${Date.now()}`;


const disabledProviderIds: string[] = [];
const createdDocIds: string[] = [];

async function deactivateEmbeddingProviders() {
  const active = await prismaClient.modelProvider.findMany({
    where: { typeModel: "EMBEDDING", isActive: true },
    select: { id: true },
  });
  for (const provider of active) {
    await prismaClient.modelProvider.update({ where: { id: provider.id }, data: { isActive: false } });
    disabledProviderIds.push(provider.id);
  }
}

async function restoreEmbeddingProviders() {
  for (const id of disabledProviderIds) {
    await prismaClient.modelProvider.update({ where: { id }, data: { isActive: true } }).catch(() => undefined);
  }
  disabledProviderIds.length = 0;
}

beforeAll(async () => {

  vectorStoreService.resetMemoryStore();
  await deactivateEmbeddingProviders();
});

afterAll(async () => {
  for (const id of createdDocIds) {
    await prismaClient.knowledgeBase.delete({ where: { id } }).catch(() => undefined);
  }
  vectorStoreService.resetMemoryStore();
  await restoreEmbeddingProviders();
});

describe("VectorStoreService - fallback textual", () => {
  it("devuelve resultados con metadata.mode textual cuando no hay proveedor EMBEDDING activo", async () => {
    const row = await prismaClient.knowledgeBase.create({
      data: {
        title: "Manual de enrutamiento de prueba",
        content: `El protocolo OSPF divide la red en áreas y ${token} evita bucles de enrutamiento.`,
      },
    });
    createdDocIds.push(row.id);

    const results = await vectorStoreService.searchDocuments(token);

    expect(results.length).toBeGreaterThan(0);
    const found = results.find((r) => r.metadata.docId === row.id);
    expect(found).toBeDefined();
    expect(found?.metadata.mode).toBe("textual");
    expect(found?.metadata.title).toBe("Manual de enrutamiento de prueba");
    expect(found?.metadata.score).toBeGreaterThan(0);
    expect(found?.content).toContain(token);
  });

  it("deleteDocument no rompe y el documento borrado desaparece de la búsqueda", async () => {
    const row = await prismaClient.knowledgeBase.create({
      data: {
        title: "Documento efímero de prueba",
        content: `Contenido único ${token} que se borra durante el test.`,
      },
    });

    const before = await vectorStoreService.searchDocuments(token);
    expect(before.some((r) => r.metadata.docId === row.id)).toBe(true);


    await prismaClient.knowledgeBase.delete({ where: { id: row.id } });
    await expect(vectorStoreService.deleteDocument(row.id)).resolves.toBeUndefined();

    const after = await vectorStoreService.searchDocuments(token);
    expect(after.some((r) => r.metadata.docId === row.id)).toBe(false);
  });
});
