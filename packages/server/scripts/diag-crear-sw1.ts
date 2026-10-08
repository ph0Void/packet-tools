import { prismaClient } from "@/prisma/lib/PrismaClient";

async function main() {
  const existing = await prismaClient.deviceProviders.findFirst({
    where: { name: "SW1_GNS3", host: "localhost", port: 5001 },
  });
  if (existing) {
    console.log(`Ya existe: ${existing.id} ${existing.name} ${existing.host}:${existing.port}`);
    return;
  }
  const created = await prismaClient.deviceProviders.create({
    data: {
      name: "SW1_GNS3",
      typeDevice: "CISCO",
      protocol: "TELNET",
      host: "localhost",
      port: 5001,
    },
  });
  console.log(`Creado: ${created.id} ${created.name} TELNET ${created.host}:${created.port} (sin usuario ni contraseña)`);
  await prismaClient.$disconnect();
}

main().catch(async (error) => {
  console.error("FALLO:", error?.message ?? error);
  await prismaClient.$disconnect().catch(() => undefined);
});
