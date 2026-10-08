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

async function consoleState(deviceName: string, label: string) {
  const result = await callTool("readDeviceConsole", { deviceName, lines: 25 });
  const text = String(result?.output ?? "");
  const lines = text.split("\n");
  console.log(`\n### consola ${deviceName} (${label}) — ${text.length} chars`);
  console.log(`  prompts vistos: ${JSON.stringify((text.match(/[A-Za-z0-9_.-]{1,20}(?:\(config[^)]*\))?[>#]/g) ?? []).slice(-3))}`);
  console.log(`  hay --More--: ${/--More--/.test(text)} | hay PressRETURN: ${/press return to get started/i.test(text)}`);
  console.log(`  ultimas 5:`);
  for (const line of lines.slice(-5)) console.log(`    | ${JSON.stringify(line)}`);
}

async function runCycle(deviceName: string, commands: string[]) {
  const startTime = Date.now();
  const sendRes = await callTool("runCommandAsync", { deviceName, commands, options: {} });
  console.log(`\n--- runCommandAsync → ${JSON.stringify(sendRes)}`);
  if (sendRes?.success === false || !sendRes?.pendienteId) {
    console.log("    sin pendienteId; el host caeria al respaldo runDeviceCommands");
    return null;
  }
  let round = 0;
  for (;;) {
    const pollRes = await callTool("pollCommandResult", {
      pendienteId: sendRes.pendienteId,
      deviceName,
      options: { esperarMs: round < 8 ? 250 : 500 },
    });
    const marks = JSON.stringify({
      done: pollRes?.done,
      estado: pollRes?.estado,
      pendienteMs: pollRes?.pendienteMs,
      fuente: pollRes?.fuente,
      enterVia: pollRes?.enterVia,
      pagerVia: pollRes?.pagerVia,
      pagerVisto: pollRes?.pagerVisto,
      bloqueoResuelto: pollRes?.bloqueoResuelto,
      comandoConsumido: pollRes?.comandoConsumido,
      paginasPagadas: pollRes?.paginasPagadas,
      bloqueoAgotado: pollRes?.bloqueoAgotado,
      corte: (pollRes?.results ?? []).map((r: any) => `${r.command}:${r.status}:${(r.corte ?? "-")}`),
    });
    console.log(`    ronda ${String(round).padStart(2)} (+${Date.now() - startTime}ms) ${marks}`);
    if (pollRes?.done) {
      console.log(`\n### results completos:`);
      console.log(JSON.stringify(pollRes?.results, null, 2).slice(0, 2500));
      return pollRes;
    }
    if (Date.now() - startTime > 40000) {
      console.log("    ABANDONO tras 40 s");
      return null;
    }
    round++;
  }
}

async function main() {
  console.log("=== DIAGNOSTICO: show running-config en 2911 recien creado ===");
  const liveness = await callTool("listDeviceModels", {});
  if (!liveness || /timeout|no est|not connected/i.test(JSON.stringify(liveness.error ?? ""))) {
    console.log("extension muda:", JSON.stringify(liveness).slice(0, 200));
    process.exit(2);
  }

  await callTool("clearWorkspace", {});
  console.log("addDevice R1 →", JSON.stringify(await callTool("addDevice", { deviceName: "R1", deviceModel: "2911", x: 200, y: 200 })));
  console.log(
    "configureIosDevice →",
    JSON.stringify(
      (
        (await callTool("configureIosDevice", {
          deviceName: "R1",
          commands:
            "hostname R1\ninterface GigabitEthernet0/0\nip address 192.168.10.1 255.255.255.0\nno shutdown\nexit",
        }))?.results ?? []
      ).map((r: any) => `${r.command}=${r.status}`),
    ),
  );

  await consoleState("R1", "tras configurar");

  console.log(`\n=== 1) lectura corta (la que pasa en la suite) ===`);
  await runCycle("R1", ["show ip int brief"]);
  await consoleState("R1", "tras la lectura corta");

  console.log(`\n=== 2) show running-config (la que falla) ===`);
  await runCycle("R1", ["show running-config"]);
  await consoleState("R1", "tras show running-config");

  console.log(`\n=== 3) lectura corta de nuevo ===`);
  await runCycle("R1", ["show ip route"]);
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
