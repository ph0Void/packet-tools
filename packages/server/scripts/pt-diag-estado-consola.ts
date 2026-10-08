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

function diagnose(text: string) {
  const lower = text.toLowerCase();
  const pressReturnPos = lower.lastIndexOf("press return to get started");
  const pressReturnTail = pressReturnPos === -1 ? "" : lower.substring(pressReturnPos).slice(-600);
  const last = text.replace(/\s+$/, "").split("\n").slice(-1)[0] ?? "";
  return {
    longitud: text.length,
    hayPressReturn: pressReturnPos !== -1,
    promptTrasPressReturn: /^[A-Za-z0-9_.\-/()[\]]{1,40}[>#]\s*$/m.test(
      pressReturnTail.split("\n").slice(1).filter((l) => l.trim()).pop() ?? "",
    ),
    hayMore: lower.includes("--more--"),
    hayYesNo: lower.includes("[yes/no]"),
    hayTranslating: lower.includes('translating "'),
    ultimaLinea: JSON.stringify(last.slice(-120)),
    ultimoPromptVisto: (text.match(/[A-Za-z0-9_.-]{1,20}(?:\(config[^)]*\))?[>#]/g) ?? []).slice(-3),
  };
}

async function main() {
  const device = process.argv[2] || "R1";
  console.log("=== ESTADO REAL DE LA CONSOLA ===");

  const liveness = await callTool("listDeviceModels", {});
  if (!liveness || /timeout|no est|not connected/i.test(JSON.stringify(liveness.error ?? ""))) {
    console.log("extension muda:", JSON.stringify(liveness).slice(0, 300));
    process.exit(2);
  }

  const result = await callTool("readDeviceConsole", { deviceName: device, lines: 60 });
  if (result?.error) {
    console.log("readDeviceConsole →", JSON.stringify(result));
    process.exit(0);
  }
  const output = String(result?.output ?? "");
  console.log(`\n### ${device}: ${JSON.stringify(diagnose(output), null, 2)}`);
  console.log(`\n### ultimas 12 lineas:`);
  for (const line of output.split("\n").slice(-12)) console.log(`  | ${line}`);
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
