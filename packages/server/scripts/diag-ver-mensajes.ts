import { prismaClient } from "@/prisma/lib/PrismaClient";

async function main() {
  const chatId = process.argv[2];
  const messages = await prismaClient.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "asc" },
    select: { role: true, content: true, createdAt: true },
  });
  for (const message of messages) {
    console.log(`\n=== ${message.role} (${message.createdAt.toISOString()}) ===`);
    console.log(String(message.content).slice(0, 1200));
  }
  await prismaClient.$disconnect();
}

main().catch(async (error) => {
  console.error("FALLO:", error?.message ?? error);
  await prismaClient.$disconnect().catch(() => undefined);
});
