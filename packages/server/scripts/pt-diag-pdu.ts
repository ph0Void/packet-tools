import { ciscoClient } from "@/client/PacketTracerClient";
import { prismaClient } from "@/prisma/lib/PrismaClient";

function unwrap(value: any): any {
  let current = value;
  while (current && typeof current === "object" && "result" in current && Object.keys(current).length <= 2) {
    current = current.result;
  }
  while (current && typeof current === "object" && typeof current.code === "string" && "result" in current) {
    current = current.result;
  }
  return current;
}

async function callTool(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  try {
    return unwrap(await ciscoClient.callTool(toolName, args));
  } catch (error: any) {
    return { error: String(error?.message ?? error) };
  }
}

function toLine(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function summarizePdu(result: any): any {
  if (Array.isArray(result)) return { esArray: true, n: result.length, items: result.slice(0, 8) };
  if (!result || typeof result !== "object") return result;
  if (result.error) return { error: result.error };
  const base: any = { success: result.success, count: result.count ?? result.results?.length };
  if (result.currentTime !== undefined) base.currentTime = result.currentTime;
  if (result.frameCount !== undefined) base.frameCount = result.frameCount;
  if (Array.isArray(result.results)) {
    base.results = result.results.slice(0, 6);
    if (result.results.length > 6) base.results.push(`…+${result.results.length - 6} mas`);
  }
  return base;
}

async function main() {
  console.log("=== SONDEO DEL FLUJO PDU ===");

  const liveness = await callTool("listDeviceModels", {});
  const isAlive = liveness && typeof liveness === "object" && !/timeout|no est|not connected/i.test(toLine(liveness.error ?? ""));
  console.log(`[${isAlive ? "OK" : "MUDA"}] extension viva`);
  if (!isAlive) {
    console.log(toLine(liveness));
    console.log("\nReinicia Packet Tracer y vuelve a lanzar este script.");
    process.exit(2);
  }

  const readDevices = async (): Promise<any[]> => {
    const response = await callTool("getNetwork", {});
    const data = response?.devices;
    if (Array.isArray(data)) return data;
    if (data && typeof data.length === "number") {
      const output: any[] = [];
      for (let i = 0; i < data.length; i++) output.push(data[i]);
      return output;
    }
    return [];
  };

  let devices = await readDevices();

  if (devices.length === 0) {
    console.log("\n### workspace vacio: montando R1 + SW1 + PC1");
    await callTool("addDevice", { deviceName: "R1", deviceModel: "2911", x: 200, y: 200 });
    await callTool("addDevice", { deviceName: "SW1", deviceModel: "2960-24TT", x: 420, y: 200 });
    await callTool("addDevice", { deviceName: "PC1", deviceModel: "PC-PT", x: 640, y: 200 });
    console.log(
      "  addLink R1-SW1:",
      toLine(
        await callTool("addLink", {
          device1Name: "R1",
          device1Interface: "GigabitEthernet0/0",
          device2Name: "SW1",
          device2Interface: "GigabitEthernet0/1",
          linkType: "straight",
        }),
      ),
    );
    console.log(
      "  addLink SW1-PC1:",
      toLine(
        await callTool("addLink", {
          device1Name: "SW1",
          device1Interface: "FastEthernet0/1",
          device2Name: "PC1",
          device2Interface: "FastEthernet0",
          linkType: "straight",
        }),
      ),
    );
    console.log(
      "  configurePcIp PC1:",
      toLine(
        await callTool("configurePcIp", {
          deviceName: "PC1",
          dhcpEnabled: false,
          ipaddress: "192.168.10.10",
          subnetMask: "255.255.255.0",
        }),
      ),
    );
    console.log(
      "  configureIosDevice R1:",
      toLine(
        await callTool("configureIosDevice", {
          deviceName: "R1",
          commands:
            "hostname R1\ninterface GigabitEthernet0/0\nip address 192.168.10.1 255.255.255.0\nno shutdown\nexit",
        }),
      ),
    );
  }

  devices = await readDevices();
  console.log(`\n### workspace: ${devices.map((d) => d?.name).join(", ") || "(vacio)"}`);
  for (const device of devices) {
    const info = await callTool("getDeviceInfo", { deviceName: device?.name });
    const ip = info?.ipAddress ?? (info?.interfaces ?? []).map((i: any) => i?.ipAddress).filter(Boolean);
    console.log(`  ${device?.name}: ${JSON.stringify(ip)}`);
  }

  const sourceName = "PC1";
  const targetName = "R1";
  if (!devices.some((d) => d?.name === sourceName) || !devices.some((d) => d?.name === targetName)) {
    console.log(`\nNecesito ${sourceName} y ${targetName} en el workspace.`);
    process.exit(0);
  }

  const stateBefore = await callTool("getSimulationStatus", {});
  console.log(`\n### estado inicial: ${toLine(stateBefore)}`);

  console.log(`\n### probing del API de modo`);
  for (const [toolName, args] of [
    ["setSimulationMode", { simulation: true }],
    ["setSimulationMode", { mode: true }],
    ["setSimulationMode", { enabled: true }],
  ] as Array<[string, any]>) {
    console.log(`  ${toolName} ${JSON.stringify(args)} -> ${toLine(await callTool(toolName, args))}`);
  }

  console.log(`\n### sendPdu ${sourceName} -> ${targetName} (sin cambiar de modo)`);
  const sendRes = await callTool("sendPdu", { sourceDevice: sourceName, destinationDevice: targetName });
  console.log(`  ${toLine(sendRes)}`);
  if (sendRes?.error || sendRes?.success === false) {
    console.log("\naddSimplePdu fue rechazado; no hay flujo que sondear.");
    process.exit(0);
  }

  console.log(`\n### getPduResults SIN avanzar`);
  console.log(`  ${JSON.stringify(await callTool("getPduResults", { types: ["ICMP"] }), null, 2).slice(0, 2500)}`);

  for (let step = 1; step <= 4; step++) {
    const stepRes = await callTool("stepSimulation", { direction: "forward", steps: 1 });
    const pduRes = await callTool("getPduResults", { types: ["ICMP"] });
    console.log(`\n### forward x1 (paso ${step}) -> ${toLine(stepRes)}`);
    console.log(`    pduResults: ${JSON.stringify(pduRes, null, 2).slice(0, 2500)}`);
  }

  const step6 = await callTool("stepSimulation", { direction: "forward", steps: 5 });
  console.log(`\n### forward x5 -> ${toLine(step6)}`);
  console.log(
    `    pduResults: ${JSON.stringify(await callTool("getPduResults", { types: ["ICMP"] }), null, 2).slice(0, 3000)}`,
  );

  console.log("\n=== FIN ===");
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
