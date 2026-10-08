import { CISCO_PACKET_TRACER_TOOLS_ADMIN } from "@/agent/ciscoPacketTracer/Tool";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { requestContext } from "@/utils/RequestContext";

function unwrap(value: any): any {
  let current = value;
  while (current && typeof current === "object" && current.code && "result" in current) current = current.result;
  return current;
}

async function invokeTool(toolName: string, input: Record<string, unknown> = {}) {
  const tool: any = CISCO_PACKET_TRACER_TOOLS_ADMIN.find(
    (t: any) => t.name === toolName,
  );
  if (!tool) return { error: `tool inexistente: ${toolName}` };
  try {
    const output = await tool.invoke(input);
    const obj = typeof output === "string" ? JSON.parse(output) : output;
    return unwrap(obj);
  } catch (error: any) {
    return { error: String(error?.message ?? error) };
  }
}

function isTimeout(result: any): boolean {
  return /timeout de 20s/i.test(String(result?.error ?? ""));
}

function truncate(value: unknown, max = 300): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 1) ?? String(value);
  return text.length > max ? text.slice(0, max) + `… [${text.length}]` : text;
}

async function checkAlive(): Promise<boolean> {
  const result = await invokeTool("listDeviceModels", {});
  return !isTimeout(result) && !result?.error;
}

async function runStep(label: string, toolName: string, input: any = {}) {
  const result = await invokeTool(toolName, input);
  const dead = isTimeout(result);
  console.log(`[${dead ? "MUDA" : "OK"}] ${toolName} → ${truncate(result)}`);
  const alive = dead ? false : await checkAlive();
  if (!alive) {
    console.log(`\n>>> CULPABLE: ${toolName} (la extensión dejó de responder)`);
    return false;
  }
  return true;
}

async function main() {
  const admin = (await prismaClient.user.findFirst({
    where: { role: "ADMIN" },
  })) as any;
  if (!admin) throw new Error("No hay usuario ADMIN en la BD (ejecuta seed)");

  await requestContext.run(
    {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      autonomous: true,
    },
    async () => {
      console.log("=== SONDEO DE SIMULACIÓN — PACKET TRACER ===\n");
      const initialAlive = await checkAlive();
      console.log(`[${initialAlive ? "OK" : "MUDA"}] vida inicial (listDeviceModels)`);
      if (!initialAlive) {
        console.log(
          "La extensión no responde: reinicia Packet Tracer y vuelve a lanzar este script.",
        );
        return;
      }

      await invokeTool("removeDevice", { deviceNames: ["QA1", "QA2"] });
      const device1 = await invokeTool("addDevice", {
        deviceName: "QA1",
        deviceModel: "2911",
        x: 150,
        y: 250,
      });
      const device2 = await invokeTool("addDevice", {
        deviceName: "QA2",
        deviceModel: "2911",
        x: 420,
        y: 250,
      });
      console.log(`[${device1?.error ? "FALLO" : "OK"}] addDevice QA1`);
      console.log(`[${device2?.error ? "FALLO" : "OK"}] addDevice QA2`);
      if (device1?.error || device2?.error) return;

      const net = await invokeTool("getNetwork", {});
      const rawDevices = net?.devices ?? net?.result?.devices;
      const list = Array.isArray(rawDevices)
        ? rawDevices
        : rawDevices && typeof rawDevices.length === "number"
          ? Array.from({ length: rawDevices.length }, (_: unknown, i: number) => rawDevices[i])
          : [];
      const getIfaces = (deviceName: string): string[] => {
        const device = list.find((x: any) => String(x.name) === deviceName);
        const interfaces = Array.isArray(device?.interfaces) ? device.interfaces : [];
        return interfaces.map((i: any) => String(i.name));
      };
      const iface1 = getIfaces("QA1").find((n) => /^GigabitEthernet/.test(n));
      const iface2 = getIfaces("QA2").find((n) => /^GigabitEthernet/.test(n));
      console.log(`       interfaces: QA1=${iface1} QA2=${iface2}`);
      if (!iface1 || !iface2) {
        console.log("No hay interfaces libres; continúo sin enlace.");
      } else {
        const linkRes = await invokeTool("addLink", {
          device1Name: "QA1",
          device1Interface: iface1,
          device2Name: "QA2",
          device2Interface: iface2,
          linkType: "straight",
        });
        console.log(`[${linkRes?.error ? "FALLO" : "OK"}] addLink → ${truncate(linkRes)}`);
      }

      await invokeTool("configureIosDevice", {
        deviceName: "QA1",
        commands: [
          "hostname QA1",
          "interface GigabitEthernet0/0",
          "ip address 10.1.1.1 255.255.255.0",
          "no shutdown",
          "exit",
        ],
      });
      await invokeTool("configureIosDevice", {
        deviceName: "QA2",
        commands: [
          "hostname QA2",
          "interface GigabitEthernet0/0",
          "ip address 10.1.1.2 255.255.255.0",
          "no shutdown",
          "exit",
        ],
      });
      console.log("[OK] IPs configuradas\n");

      const sequence: [string, string, any][] = [
        ["1. lectura", "getSimulationStatus", {}],
        ["2. lectura", "getPduResults", { types: ["ICMP"] }],
        ["3. modo", "setSimulationMode", { toSimMode: true }],
        ["4. modo", "setSimulationMode", { toSimMode: false }],
        ["5. PDU", "sendPdu", { sourceDevice: "QA1", destinationDevice: "QA2" }],
        ["6. paso", "stepSimulation", { direction: "forward", steps: 1 }],
        ["7. ping", "pingDevices", { sourceName: "QA1", targetName: "QA2" }],
        [
          "8. matriz",
          "reachabilityMatrix",
          { sourceName: "QA1", targetNames: ["QA2"] },
        ],
      ];

      for (const [title, toolName, input] of sequence) {
        console.log(`--- ${title}: ${toolName} ---`);
        const keepGoing = await runStep(title, toolName, input);
        if (!keepGoing) break;
      }

      if (await checkAlive()) {
        await invokeTool("setSimulationMode", { toSimMode: false });
        await invokeTool("removeDevice", { deviceNames: ["QA1", "QA2"] });
        console.log("\nLimpieza OK.");
      }
      console.log("\n=== FIN ===");
    },
  );
}

main()
  .catch((error) => {
    console.error("ERROR:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
