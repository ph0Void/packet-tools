import { ciscoClient } from "@/client/PacketTracerClient";
import { prismaClient } from "@/prisma/lib/PrismaClient";

function unwrap(value: any): any {
  let current = value;
  while (
    current &&
    typeof current === "object" &&
    typeof current.code === "string" &&
    "result" in current
  ) {
    current = current.result;
  }
  return current;
}

async function callTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<any> {
  try {
    const output = await ciscoClient.callTool(toolName, args);
    return unwrap(output);
  } catch (error: any) {
    return { error: String(error?.message ?? error) };
  }
}

function show(title: string, result: any): void {
  console.log(`\n### ${title}`);
  console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
}

function toArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value.length === "number" && typeof value !== "string") {
    const output: any[] = [];
    for (let i = 0; i < value.length; i++) output.push(value[i]);
    return output;
  }
  return [];
}

async function main() {
  const device = process.argv[2] || "R1";

  console.log("=== DIAGNÓSTICO DE CONSOLA IOS — PACKET TRACER ===");
  console.log(`Equipo: ${device}`);

  const liveness = await callTool("listDeviceModels", {});
  const isAlive =
    liveness && typeof liveness === "object" && !/timeout/i.test(String(liveness.error ?? ""));
  console.log(`[${isAlive ? "OK" : "MUDA"}] extensión viva`);
  if (!isAlive) {
    console.log(JSON.stringify(liveness, null, 2));
    process.exit(isAlive ? 0 : 2);
  }

  const network = await callTool("getNetwork", {});
  const list = toArray(network?.devices);
  console.log(
    `dispositivos: ${list.map((d: any) => d?.name).join(", ") || "(ninguno)"}`,
  );

  if (!list.some((d: any) => String(d?.name) === device)) {
    console.log(`\nNo existe ${device}: creando topologia de prueba...`);
    console.log(
      "addDevice R1 →",
      JSON.stringify(
        await callTool("addDevice", {
          deviceName: device,
          deviceModel: "2911",
          x: 200,
          y: 200,
        }),
      ),
    );
    console.log(
      "addDevice PC1 →",
      JSON.stringify(
        await callTool("addDevice", {
          deviceName: "PC1",
          deviceModel: "PC-PT",
          x: 500,
          y: 200,
        }),
      ),
    );
    console.log(
      "addLink →",
      JSON.stringify(
        await callTool("addLink", {
          device1Name: device,
          device1Interface: "GigabitEthernet0/0",
          device2Name: "PC1",
          device2Interface: "FastEthernet0",
        }),
      ),
    );
    console.log(
      "configurePcIp →",
      JSON.stringify(
        await callTool("configurePcIp", {
          deviceName: "PC1",
          dhcpEnabled: false,
          ipaddress: "192.168.10.10",
          subnetMask: "255.255.255.0",
        }),
      ),
    );
  }

  show(
    'runDeviceCommands ["show clock"] waitMs=3000',
    await callTool("runDeviceCommands", {
      deviceName: device,
      commands: ["show clock"],
      options: { waitMs: 3000, maxChars: 4000 },
    }),
  );

  show(
    'runDeviceCommands ["show running-config"] waitMs=3000',
    await callTool("runDeviceCommands", {
      deviceName: device,
      commands: ["show running-config"],
      options: { waitMs: 3000, maxChars: 6000 },
    }),
  );

  show("getDeviceConfigSnapshot", await callTool("getDeviceConfigSnapshot", { deviceName: device }));

  show(
    'runDeviceCommands ["no"] (respuesta al dialogo) waitMs=3000',
    await callTool("runDeviceCommands", {
      deviceName: device,
      commands: ["no"],
      options: { waitMs: 3000, maxChars: 4000 },
    }),
  );
  show(
    'runDeviceCommands ["show clock"] (tras responder) waitMs=3000',
    await callTool("runDeviceCommands", {
      deviceName: device,
      commands: ["show clock"],
      options: { waitMs: 3000, maxChars: 4000 },
    }),
  );

  const other =
    list
      .map((d: any) => String(d?.name))
      .find((n: string) => n !== device && /^(PC|Server|Laptop)/.test(n)) ||
    "PC1";
  if (other) {
    show(
      `pingDevices ${other} → ${device}`,
      await callTool("pingDevices", { sourceName: other, targetName: device, options: {} }),
    );
  }

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
