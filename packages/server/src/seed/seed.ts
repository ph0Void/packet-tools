import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";
import { runSeed } from "./SeedService";

runSeed()
  .catch((error) => {
    Logger.error({ message: "Error ejecutando seed", data: error });
    process.exitCode = 1;
  })
  .finally(() => prismaClient.$disconnect());
