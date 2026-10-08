import { ciscoClient } from "@/client/PacketTracerClient";
import { prismaClient } from "@/prisma/lib/PrismaClient";

function unwrap(value: any): any {
  let current = value;
  while (current && typeof current === "object" && typeof current.code === "string" && "result" in current) {
    current = current.result;
  }
  return current;
}

async function callTool(toolName: string, args: Record<string, unknown>): Promise<any> {
  try {
    return unwrap(await ciscoClient.callTool(toolName, args));
  } catch (error: any) {
    return { error: String(error?.message ?? error) };
  }
}

function summarizeConsole(text: string) {
  const content = String(text || "");
  const bootPos = content.search(/system bootstrap|self decompressing|cisco systems/i);
  return {
    longitud: content.length,
    lineas: content.split("\n").length,
    arranqueEnPos: bootPos,
    cola: content.slice(-220).replace(/\n/g, "\\n"),
    cabeza: content.slice(0, 180).replace(/\n/g, "\\n"),
  };
}

async function main() {
  const device = process.argv[2] || "R1";
  console.log("=== DIAGNÓSTICO DEL CORTE DE SALIDA ===");

  const liveness = await callTool("listDeviceModels", {});
  const isAlive = liveness && typeof liveness === "object" && !/timeout/i.test(String(liveness.error ?? ""));
  console.log(`[${isAlive ? "OK" : "MUDA"}] extensión viva`);
  if (!isAlive) process.exit(2);

  console.log(`\n### montando topologia de prueba (R1 + SW1 + PC1)`);
  await callTool("removeDevice", { deviceNames: [device, "SW1", "PC1"] });
  await callTool("addDevice", { deviceName: device, deviceModel: "2911", x: 200, y: 200 });
  await callTool("addDevice", { deviceName: "SW1", deviceModel: "2960-24TT", x: 420, y: 200 });
  await callTool("addDevice", { deviceName: "PC1", deviceModel: "PC-PT", x: 640, y: 200 });
  console.log(
    "addLink →",
    JSON.stringify(
      await callTool("addLink", {
        device1Name: device,
        device1Interface: "GigabitEthernet0/0",
        device2Name: "SW1",
        device2Interface: "GigabitEthernet0/1",
      }),
    ),
  );
  console.log(
    "addLink →",
    JSON.stringify(
      await callTool("addLink", {
        device1Name: "SW1",
        device1Interface: "FastEthernet0/1",
        device2Name: "PC1",
        device2Interface: "FastEthernet0",
      }),
    ),
  );
  await callTool("configurePcIp", {
    deviceName: "PC1",
    dhcpEnabled: false,
    ipaddress: "192.168.10.10",
    subnetMask: "255.255.255.0",
  });
  const configRes = await callTool("configureIosDevice", {
    deviceName: device,
    commands:
      "hostname R1\ninterface GigabitEthernet0/0\nip address 192.168.10.1 255.255.255.0\nno shutdown\nexit",
  });
  console.log(
    "configureIosDevice →",
    JSON.stringify(
      (configRes?.results ?? []).map((r: any) => `${r.command}=${r.status}`),
    ),
  );

  const consoleRes = await callTool("readDeviceConsole", { deviceName: device, lines: 5000 });
  if (consoleRes?.error) {
    console.log("readDeviceConsole →", JSON.stringify(consoleRes));
  } else {
    console.log(`\n### buffer de ${device} ahora mismo`);
    console.log(JSON.stringify(summarizeConsole(consoleRes?.output ?? ""), null, 2));
  }

  const beforeRes = await callTool("readDeviceConsole", { deviceName: device, lines: 5000 });
  const beforeLength = String(beforeRes?.output ?? "").length;

  const cmdRes = await callTool("runDeviceCommands", {
    deviceName: device,
    commands: ["show ip route"],
    options: { waitMs: 1500, maxChars: 8000 },
  });
  const cmdOutput = String(cmdRes?.results?.[0]?.output ?? "");
  console.log(`\n### output de 'show ip route' (status=${cmdRes?.results?.[0]?.status})`);
  console.log(
    JSON.stringify(
      {
        longitudBufferAntes: beforeLength,
        longitudSalida: cmdOutput.length,
        pareceBufferEntero: /system bootstrap|self decompressing/i.test(cmdOutput),
        arranqueEnSalida: cmdOutput.search(/system bootstrap|self decompressing/i),
        primeros240: cmdOutput.slice(0, 240).replace(/\n/g, "\\n"),
        ultimos160: cmdOutput.slice(-160).replace(/\n/g, "\\n"),
      },
      null,
      2,
    ),
  );

  const afterRes = await callTool("readDeviceConsole", { deviceName: device, lines: 5000 });
  console.log(`\n### buffer despues`);
  console.log(JSON.stringify(summarizeConsole(afterRes?.output ?? ""), null, 2));

  console.log(`\n=== SECUENCIA DE LA SUITE (Fase B) ===`);
  const steps = [
    ["show ip int brief", 1500],
    ["show running-config", 2500],
    ["show ip route", 1500],
  ];
  for (const [command, wait] of steps as Array<[string, number]>) {
    const stepRes = await callTool("runDeviceCommands", {
      deviceName: device,
      commands: [command],
      options: { waitMs: wait, maxChars: 20000 },
    });
    const stepOutput = String(stepRes?.results?.[0]?.output ?? "");
    const bootPos = stepOutput.search(/system bootstrap|self decompressing|cisco systems/i);
    console.log(
      `\n--- ${command}: status=${stepRes?.results?.[0]?.status} longitud=${stepOutput.length} ` +
        `arranqueEn=${bootPos} despertar=${JSON.stringify(stepRes?.despertar)}`,
    );
    console.log(`    primeros200: ${JSON.stringify(stepOutput.slice(0, 200))}`);
    console.log(`    ultimos200:  ${JSON.stringify(stepOutput.slice(-200))}`);
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
