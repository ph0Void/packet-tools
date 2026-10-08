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

function summarize(result: any): any {
  if (!result || typeof result !== "object") return result;
  if (result.error) return result;
  const results = Array.isArray(result.results) ? result.results : [];
  return {
    despertar: result.despertar,
    warning: result.warning,
    results: results.map((x: any) => ({
      cmd: x.command,
      status: x.status,
      out: String(x.output ?? "").replace(/\n/g, "\\n").slice(0, 220),
    })),
  };
}

async function runCommands(
  deviceName: string,
  commands: string[],
  mode: string,
  waitMs = 1500,
): Promise<any> {
  const result = await callTool("runDeviceCommands", {
    deviceName,
    commands,
    options: { mode, waitMs, maxChars: 4000 },
  });
  return summarize(result);
}

async function main() {
  const device = process.argv[2] || "DIAG1";

  console.log("=== DIAGNÓSTICO DE MODOS IOS — PACKET TRACER ===");

  const liveness = await callTool("listDeviceModels", {});
  const isAlive = liveness && typeof liveness === "object" && !/timeout/i.test(String(liveness.error ?? ""));
  console.log(`[${isAlive ? "OK" : "MUDA"}] extensión viva`);
  if (!isAlive) {
    console.log(JSON.stringify(liveness, null, 2));
    process.exit(2);
  }

  await callTool("removeDevice", { deviceNames: [device] });
  const created = await callTool("addDevice", { deviceName: device, deviceModel: "2911", x: 200, y: 400 });
  console.log(`addDevice ${device} →`, JSON.stringify(created));
  if (!created?.success) process.exit(1);

  console.log("\n--- 1) sondeo base: mode '' ---");
  console.log(JSON.stringify(await runCommands(device, ["show clock"], ""), null, 2));

  console.log("\n--- 2) mode 'global' directo (el que usa configureIosDevice) ---");
  console.log(
    JSON.stringify(await runCommands(device, ["hostname DIAGPRUEBA"], "global"), null, 2),
  );

  console.log("\n--- 3) mode 'enable' directo (show debería funcionar si el modo se aplica) ---");
  console.log(JSON.stringify(await runCommands(device, ["show clock"], "enable"), null, 2));

  console.log("\n--- 4) modo MANUAL: enable + conf t en el mismo lote, mode '' ---");
  console.log(
    JSON.stringify(
      await runCommands(device, ["enable", "configure terminal", "hostname DIAGPRUEBA", "exit"], ""),
      null,
      2,
    ),
  );

  console.log("\n--- 5) comprobación tras el lote manual: ¿hostname cambió y estamos en #? ---");
  console.log(JSON.stringify(await runCommands(device, ["show clock"], "enable"), null, 2));

  console.log("\n--- 6) REPRODUCCIÓN del fallo: 'no shutdown' en modo usuario ---");
  console.log(JSON.stringify(await runCommands(device, ["no shutdown"], "user"), null, 2));

  console.log("\n--- 7) ¿sigue bloqueado? (otro comando tras el 'no') ---");
  console.log(JSON.stringify(await runCommands(device, ["show clock"], "enable"), null, 2));

  console.log("\n--- 8) intentos de DESBLOQUEO con caracteres de control ---");
  const escapes: Array<[string, string]> = [
    ["Ctrl+^ (\\u001e)", "\u001e"],
    ["Ctrl+C (\\u0003)", "\u0003"],
    ["Ctrl+Z (\\u001a)", "\u001a"],
    ["Ctrl+V (\\u0016)", "\u0016"],
  ];
  for (const [label, byte] of escapes) {
    const result = await runCommands(device, [byte], "", 1200);
    const blocked = result?.results?.[0]?.out?.length === 0 || /translating/i.test(result?.results?.[0]?.out ?? "");
    console.log(`${label} → ${JSON.stringify(result)}`);
    if (!blocked) {
      console.log("  ¡DESBLOQUEADO con este byte!");
      break;
    }
  }

  console.log("\n--- 9) estado final ---");
  console.log(JSON.stringify(await runCommands(device, ["show clock"], "enable"), null, 2));
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
