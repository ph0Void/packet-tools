import fs from "fs";
import path from "path";
import { CISCO_PACKET_TRACER_TOOLS_ADMIN } from "@/agent/ciscoPacketTracer/Tool";
import { getToolPolicy } from "@/agent/security/ToolPolicy";

interface ToolInvokable {
  name: string;
  invoke: (input: Record<string, unknown>) => Promise<unknown>;
}

const IOS_TYPES = [0, 1, 16];
const HOST_TYPES = [8, 9, 10, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 40];

let passed = 0;
let failed = 0;

function truncate(value: unknown, max = 700): string {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
  return text.length > max ? text.slice(0, max) + `… [${text.length} chars]` : text;
}

function reportResult(level: "OK" | "FALLO", title: string, detail?: unknown) {
  if (level === "OK") passed++;
  else failed++;
  console.log(`\n[${level}] ${title}`);
  if (detail !== undefined) console.log(truncate(detail));
}

function unwrap(value: unknown): any {
  let current: any = value;
  for (let i = 0; i < 4; i++) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    if (!("code" in current) || !("result" in current)) break;
    current = current.result;
  }
  return current;
}

async function invokeTool(
  toolName: string,
  input: Record<string, unknown>,
): Promise<any> {
  const tool = CISCO_PACKET_TRACER_TOOLS_ADMIN.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Tool no encontrada: ${toolName}`);
  const output = await (tool as unknown as ToolInvokable).invoke(input);
  if (typeof output === "string") {
    try {
      return unwrap(JSON.parse(output));
    } catch {
      return unwrap(output);
    }
  }
  return unwrap(output);
}

function isOk(value: any): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    value.success !== false &&
    !value.error
  );
}

function outputText(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const obj = result as any;
    if (Array.isArray(obj.results)) {
      return obj.results.map((r: any) => r.output ?? "").join("\n");
    }
    if (obj.result && typeof obj.result === "object") {
      return outputText(obj.result);
    }
  }
  return JSON.stringify(result);
}

async function main() {
  console.log("=== CHECKLIST EXTENSIÓN PACKET TRACER ===\n");

  const networkRes = await invokeTool("getNetwork", {});
  const net = networkRes && typeof networkRes === "object" && networkRes.result ? networkRes.result : networkRes;
  if (!net || networkRes?.success === false || networkRes?.error) {
    reportResult("FALLO", "0. getNetwork (descubrir topología)", networkRes);
    console.log("\nPacket Tracer no respondió. ¿Está la extensión conectada?");
    process.exit(1);
  }

  const devices: any[] = Array.isArray(net.devices) ? net.devices : [];
  const links: any[] = Array.isArray(net.connections) ? net.connections : [];
  const router =
    devices.find((d) => IOS_TYPES.includes(d.type)) ??
    devices.find((d) => /router|switch|catalyst/i.test(String(d.model)));
  const host =
    devices.find((d) => HOST_TYPES.includes(d.type)) ??
    devices.find((d) => /pc|server|laptop/i.test(String(d.model)));

  console.log(
    `Topología: ${devices.length} dispositivos, ${links.length} enlaces (connectionCount=${net.connectionCount ?? "?"})`,
  );
  console.log(`Router/switch: ${router?.name ?? "(ninguno)"} — ${router?.model ?? ""}`);
  console.log(`Host: ${host?.name ?? "(ninguno)"} — ${host?.model ?? ""}`);
  if (!router) {
    reportResult("FALLO", "0. No hay router/switch en la topología para las pruebas");
  }

  if (router) {
    const result1 = await invokeTool("runDeviceCommand", {
      deviceName: router.name,
      command: "show ip int brief",
    });
    const text = outputText(result1);
    const noOutput =
      result1?.warning === "console_output_unavailable" ||
      text.includes("console_output_unavailable");
    if (isOk(result1) && !noOutput && text.trim().length > 0) {
      reportResult("OK", "1. runDeviceCommand('show ip int brief') devuelve stdout real", text);
    } else {
      reportResult("FALLO", "1. runDeviceCommand sin stdout real", result1);
    }

    const startTime = Date.now();
    try {
      const result2 = await invokeTool("runDeviceCommand", {
        deviceName: router.name,
        command: "show running-config",
      });
      const seconds = ((Date.now() - startTime) / 1000).toFixed(1);
      const text2 = outputText(result2);
      if (!isOk(result2)) {
        reportResult("FALLO", `2. show running-config no devolvió salida (s=${seconds}s)`, result2);
      } else if (text2.includes("--More--")) {
        reportResult("FALLO", `2. show running-config dejó el marcador --More-- (s=${seconds}s)`, text2.slice(-400));
      } else if (text2.trim().length < 50) {
        reportResult("FALLO", `2. show running-config casi vacío (s=${seconds}s)`, result2);
      } else {
        reportResult(
          "OK",
          `2. show running-config sin --More-- (${seconds}s, ${text2.length} chars)`,
          text2.slice(0, 300),
        );
      }
    } catch (error) {
      reportResult("FALLO", "2. show running-config no respondió (¿timeout 20s?)", String(error));
    }

    const batch = [
      "interface Loopback0",
      "ip address 10.255.255.1 255.255.255.255",
      "este-comando-no-existe-xyz",
      "exit",
    ].join("\n");
    const result3 = await invokeTool("configureIosDevice", {
      deviceName: router.name,
      commands: batch,
    });
    const lines: any[] = Array.isArray(result3?.results) ? result3.results : [];
    const statuses = lines.map((l) => `${l.status}: ${l.command}`);
    const invalidLine = lines.find((l) => /no-existe/.test(l.command));
    const validLines = lines.filter((l) => !/no-existe/.test(l.command));
    if (
      isOk(result3) &&
      invalidLine?.status === "error" &&
      validLines.length > 0 &&
      validLines.every((l) => l.status === "ok")
    ) {
      reportResult("OK", "3. configureIosDevice informa estado por línea", statuses);
    } else {
      reportResult("FALLO", "3. Estado por línea incorrecto", result3);
    }

    const verifyRes = await invokeTool("runDeviceCommand", {
      deviceName: router.name,
      command: "show ip int brief",
    });
    const hasLoopback = outputText(verifyRes).includes("Loopback0");
    reportResult(
      hasLoopback ? "OK" : "FALLO",
      "3b. Loopback0 visible en 'show ip int brief' tras configurarlo",
      outputText(verifyRes).slice(0, 400),
    );

    const rollbackRes = await invokeTool("configureIosDevice", {
      deviceName: router.name,
      commands: ["exit", "no interface Loopback0"].join("\n"),
    });
    const afterRes = await invokeTool("runDeviceCommand", {
      deviceName: router.name,
      command: "show ip int brief",
    });
    const stillExists = outputText(afterRes).includes("Loopback0");
    reportResult(
      stillExists ? "FALLO" : "OK",
      stillExists
        ? "3c. ROLLBACK PENDIENTE: Loopback0 sigue creado (revisar a mano)"
        : "3c. Rollback correcto: Loopback0 eliminado",
      rollbackRes?.summary ?? rollbackRes,
    );
  }

  if (host) {
    try {
      const result4 = await invokeTool("runDeviceCommand", {
        deviceName: host.name,
        command: "ipconfig",
      });
      const text4 = outputText(result4);
      if (isOk(result4) && text4.trim().length > 0 && !result4?.warning) {
        reportResult("OK", `4. ipconfig en ${host.name} (getCommandLine)`, text4);
      } else {
        reportResult("FALLO", `4. ipconfig en ${host.name} sin salida`, result4);
      }
    } catch (error) {
      reportResult("FALLO", "4. ipconfig no respondió", String(error));
    }
  }

  if (host && router) {
    try {
      const result5 = await invokeTool("pingTopology", {
        sourceName: host.name,
        targetName: router.name,
      });
      reportResult(
        isOk(result5) && result5?.ok === true ? "OK" : "FALLO",
        `5. pingTopology ${host.name} → ${router.name}`,
        result5,
      );
    } catch (error) {
      reportResult("FALLO", "5. pingTopology no respondió (¿timeout 20s?)", String(error));
    }
  }

  const modelsRes = await invokeTool("listDeviceModels", {});
  const models: any[] = modelsRes?.models ?? [];
  reportResult(
    isOk(modelsRes) && models.length >= 50 ? "OK" : "FALLO",
    `6a. listDeviceModels → ${models.length} modelos (se esperan ~150)`,
    models.slice(0, 8).map((m: any) => m.id ?? m),
  );

  if (router) {
    const modulesRes = await invokeTool("listDeviceModules", { deviceName: router.name });
    const modules: any[] = modulesRes?.modules ?? [];
    reportResult(
      isOk(modulesRes) && modules.length > 0 ? "OK" : "FALLO",
      `6b. listDeviceModules(${router.name}) → ${modules.length} módulos`,
      modules.slice(0, 12),
    );
  }

  const exportName = `checklist-${Date.now()}`;
  let exportPath = "";
  try {
    const result7 = await invokeTool("exportTopologyFile", { filename: exportName });
    exportPath = String(result7?.path ?? "");
    const exists = exportPath && fs.existsSync(exportPath);
    reportResult(
      isOk(result7) && exists ? "OK" : "FALLO",
      `7. exportTopologyFile → ${exportPath || "(sin path)"}`,
      { ...result7, base64: undefined },
    );
  } catch (error) {
    reportResult("FALLO", "7. exportTopologyFile no respondió (¿timeout 20s?)", String(error));
  }

  const policy = getToolPolicy("clearWorkspace");
  reportResult(
    policy.access === "mutating" && policy.autoApprove !== true
      ? "OK"
      : "FALLO",
    "9. clearWorkspace exige aprobación humana (no se ejecuta: desterraría la topología)",
    policy,
  );

  const importName = path.basename(exportPath || `${exportName}.pkt`);
  try {
    const result8 = await invokeTool("importTopologyFile", { filename: importName });
    const networkRes2 = await invokeTool("getNetwork", {});
    const network2 = networkRes2 && typeof networkRes2 === "object" && networkRes2.result ? networkRes2.result : networkRes2;
    const deviceCount = Array.isArray(network2?.devices) ? network2.devices.length : 0;
    reportResult(
      isOk(result8) && deviceCount > 0 ? "OK" : "FALLO",
      `8. importTopologyFile(${importName}) → ${deviceCount} dispositivos tras recargar`,
      result8,
    );
  } catch (error) {
    reportResult("FALLO", "8. importTopologyFile no respondió (¿timeout 20s?)", String(error));
  }

  console.log("\n=== RESUMEN ===");
  console.log(`OK: ${passed}   FALLOS: ${failed}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Error fatal:", error);
  process.exit(2);
});
