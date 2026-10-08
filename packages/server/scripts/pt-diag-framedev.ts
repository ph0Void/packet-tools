import { ciscoClient } from "@/client/PacketTracerClient";
import { prismaClient } from "@/prisma/lib/PrismaClient";

function unwrap(value: any): any {
  let current = value;
  while (current && typeof current === "object" && "result" in current && Object.keys(current).length <= 2) current = current.result;
  while (current && typeof current === "object" && typeof current.code === "string" && "result" in current) current = current.result;
  return current;
}

async function callTool(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  try {
    return unwrap(await ciscoClient.callTool(toolName, args));
  } catch (error: any) {
    return { error: String(error?.message ?? error) };
  }
}

async function main() {
  console.log("=== CAMPOS REALES DE UN FRAME (PT 9) ===");
  const liveness = await callTool("listDeviceModels", {});
  if (!liveness || /timeout|no est|not connected/i.test(JSON.stringify(liveness.error ?? ""))) {
    console.log("extension muda");
    process.exit(2);
  }

  const network = await callTool("getNetwork", {});
  const devices: any[] = Array.isArray(network?.devices) ? network.devices : [];
  const sourceName = devices.find((d) => /^pc/i.test(String(d?.name)))?.name;
  const targetName = devices.find((d) => /r1|router/i.test(String(d?.name)))?.name;
  if (!sourceName || !targetName) {
    console.log("Necesito un PC y un router");
    process.exit(0);
  }

  console.log(`modo: ${JSON.stringify(await callTool("setSimulationMode", { toSimMode: true }))}`);
  const resetRes = await callTool("sendPdu", { sourceDevice: sourceName, destinationDevice: targetName });
  console.log(`sendPdu: ${JSON.stringify(resetRes)}`);
  for (let i = 0; i < 6; i++) await callTool("stepSimulation", { direction: "forward", steps: 1 });
  const pdu = await callTool("getPduResults", { types: ["ICMP"] });

  console.log(`\n### getPduResults CRUDA (${pdu?.totalFrames} frames totales)`);
  console.log(JSON.stringify(pdu, null, 2).slice(0, 3000));

  const frames = Array.isArray(pdu?.frames) ? pdu.frames : [];
  console.log(`\n### RESUMEN DE CAMPOS (${frames.length} frames mostrados)`);
  for (const frame of frames) {
    console.log(
      `  idx=${String(frame.index).padStart(3)} status=${String(frame.status).padEnd(14)} ` +
        `device=${JSON.stringify(frame.device)} transit=${JSON.stringify(frame.transitTime)} ` +
        `source=${JSON.stringify(frame.source)} destination=${JSON.stringify(frame.destination)}`,
    );
  }
  const withDevice = frames.filter((f: any) => typeof f.device === "string" && f.device.trim()).length;
  console.log(`\nframes CON device no vacio: ${withDevice}/${frames.length}`);
  console.log(`CLAVES de un frame: ${frames[0] ? Object.keys(frames[0]).join(", ") : "(sin frames)"}`);

  console.log(`\nrestaurando: ${JSON.stringify(await callTool("setSimulationMode", { toSimMode: false }))}`);
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prismaClient.$disconnect();
    } catch {
    }
    process.exit(process.exitCode ?? 0);
  });
