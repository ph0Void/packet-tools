import { ciscoClient } from "@/client/PacketTracerClient";
import { prismaClient } from "@/prisma/lib/PrismaClient";

async function main() {
  const result: any = await ciscoClient.callTool("getNetwork", {});
  console.log("=== getNetwork CRUDA ===");
  console.log(JSON.stringify(result, null, 2).slice(0, 4000));
  console.log("\n=== claves raiz ===", Object.keys(result ?? {}).join(", "));
  if (result?.devices) {
    console.log("typeof devices:", typeof result.devices, "| length:", result.devices.length);
    console.log("devices[0]:", JSON.stringify(result.devices[0] ?? null).slice(0, 500));
  }
}

main()
  .catch((error) => console.error("ERROR:", error))
  .finally(async () => {
    try {
      await prismaClient.$disconnect();
    } catch {
    }
    process.exit(0);
  });
