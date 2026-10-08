import { prismaClient } from "@/prisma/lib/PrismaClient";
import { userService } from "@/service/UserService";
import { Logger } from "@/utils/Logger";
import { PROMT_SEED, esSeedAnteriorSinPersonalizar } from "./promtSeed";

export async function runSeed(): Promise<void> {
  const existingAdmin = await prismaClient.user.findUnique({
    where: { username: "admin" },
  });
  if (!existingAdmin) await userService.register("admin", "admin123", "ADMIN");

  const packetTracer = await prismaClient.deviceProviders.findFirst({
    where: { typeDevice: "PACKET_TRACER" },
  });
  if (!packetTracer)
    await prismaClient.deviceProviders.create({
      data: {
        name: "Cisco Packet Tracer",
        typeDevice: "PACKET_TRACER",
        protocol: "SIMULATION",
        host: "http://127.0.0.1:7531",
        status: "OFFLINE",
      },
    });

  const gns3 = await prismaClient.deviceProviders.findFirst({
    where: { typeDevice: "GNS3" },
  });
  if (!gns3)
    await prismaClient.deviceProviders.create({
      data: {
        name: "GNS3",
        typeDevice: "GNS3",
        protocol: "SIMULATION",
        host: "http://localhost:3080/v2",
        status: "OFFLINE",
      },
    });

  const chatModel = await prismaClient.modelProvider.findFirst({
    where: { typeModel: "CHAT" },
  });
  if (!chatModel)
    await prismaClient.modelProvider.create({
      data: {
        name: "qwen3.5-4b",
        provider: "LMSTUDIO",
        modelName: "qwen3.5-4b",
        typeModel: "CHAT",
        isActive: false,
      },
    });

  const embeddingModel = await prismaClient.modelProvider.findFirst({
    where: { typeModel: "EMBEDDING" },
  });
  if (!embeddingModel)
    await prismaClient.modelProvider.create({
      data: {
        name: "nomic-embed-text-v1.5",
        provider: "LMSTUDIO",
        modelName: "text-embedding-nomic-embed-text-v1.5",
        typeModel: "EMBEDDING",
        isActive: false,
      },
    });

  let config = await prismaClient.configuration.findFirst();
  if (!config)
    config = await prismaClient.configuration.create({
      data: {
        systemPrompt: PROMT_SEED,
      },
    });

  if (esSeedAnteriorSinPersonalizar(config.systemPrompt)) {
    config = await prismaClient.configuration.update({
      where: { id: config.id },
      data: { systemPrompt: PROMT_SEED },
    });
    Logger.info({ message: "Prompt global migrado al seed vigente (Fase 4)" });
  }

  const chatModelId = chatModel?.id;
  const embeddingModelId = embeddingModel?.id;

  if (chatModelId && embeddingModelId) {
    await prismaClient.configuration.update({
      where: { id: config.id },
      data: {
        modelProviders: {
          connect: [
            { id: chatModelId },
            { id: embeddingModelId },
          ],
        },
      },
    });
  }

  Logger.info({ message: "Seed ejecutado exitosamente" });
}
