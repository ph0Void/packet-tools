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

async function fetchState(): Promise<string> {
  const state = await callTool("getSimulationStatus", {});
  return `mode=${state?.mode} frames=${state?.frameCount} t=${state?.currentTime}`;
}

async function runProbe(source: string, target: string, label: string) {
  const before = await callTool("getSimulationStatus", {});
  const ping = await callTool("pingDevices", { sourceName: source, targetName: target, options: {} });
  const after = await callTool("getSimulationStatus", {});
  const frames = (Number(after?.frameCount ?? 0) || 0) - (Number(before?.frameCount ?? 0) || 0);
  console.log(`\n--- ${label}: ${source} -> ${target}`);
  console.log(`    frames nuevos: ${frames}`);
  console.log(`    veredicto: ${ping?.status} ok=${ping?.ok} metodo=${ping?.metodo} ` +
    `sent=${ping?.sent} rec=${ping?.received} loss=${ping?.lossPercent}% rtt=${ping?.rttAvg}`);
  console.log(`    salida: ${String(ping?.output ?? ping?.error ?? "").slice(0, 260)}`);
  return { frames, ping };
}

async function main() {
  console.log("=== VALIDACION DEL PING POR PDU ===");

  const liveness = await callTool("listDeviceModels", {});
  if (!liveness || /timeout|no est|not connected/i.test(JSON.stringify(liveness.error ?? ""))) {
    console.log("extension muda:", JSON.stringify(liveness));
    process.exit(2);
  }

  const network = await callTool("getNetwork", {});
  const devices: any[] = Array.isArray(network?.devices) ? network.devices : [];
  console.log(`workspace: ${devices.map((d) => d?.name).join(", ")}`);
  const sourceName = devices.find((d) => /^pc/i.test(String(d?.name)))?.name;
  const routerName = devices.find((d) => /r1|router/i.test(String(d?.name)))?.name;
  if (!sourceName || !routerName) {
    console.log("Necesito un PC y un router en el workspace.");
    process.exit(0);
  }

  console.log(`\n[1] estado inicial: ${await fetchState()}`);
  console.log(`    setSimulationMode({toSimMode:false}) -> ${JSON.stringify(await callTool("setSimulationMode", { toSimMode: false }))}`);
  console.log(`    estado: ${await fetchState()}`);
  const realtime = await runProbe(sourceName, routerName, "REALTIME");

  console.log(`\n[2] setSimulationMode({toSimMode:true}) -> ${JSON.stringify(await callTool("setSimulationMode", { toSimMode: true }))}`);
  console.log(`    estado: ${await fetchState()}`);
  const sim1 = await runProbe(sourceName, routerName, "SIMULATION");
  const sim2 = await runProbe(sourceName, routerName, "SIMULATION (2º intento)");

  const noIpDevice = devices.find(
    (d) => String(d?.name) !== sourceName && String(d?.name) !== routerName && !d?.ipAddress,
  );
  if (noIpDevice) await runProbe(sourceName, String(noIpDevice.name), "NEGATIVO (destino sin IP)");

  console.log(`\n[3] setSimulationMode({toSimMode:false}) -> ${JSON.stringify(await callTool("setSimulationMode", { toSimMode: false }))}`);
  console.log(`    estado final: ${await fetchState()}`);

  console.log(`\n=== RESUMEN ===`);
  console.log(`REALTIME      : frames=${realtime.frames} status=${realtime.ping?.status} metodo=${realtime.ping?.metodo}`);
  console.log(`SIMULATION 1  : frames=${sim1.frames} status=${sim1.ping?.status} metodo=${sim1.ping?.metodo}`);
  console.log(`SIMULATION 2  : frames=${sim2.frames} status=${sim2.ping?.status} metodo=${sim2.ping?.metodo}`);
  console.log(`\nCONCLUSION: el PDU ${sim1.frames > realtime.frames ? "SÍ" : "NO"} fluye en simulacion.`);
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
