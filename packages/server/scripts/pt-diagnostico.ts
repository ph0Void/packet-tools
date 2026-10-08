import { ciscoClient } from "@/client/PacketTracerClient";

function print(title: string, value: unknown) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
  console.log(`\n--- ${title} ---`);
  console.log(text.length > 1500 ? text.slice(0, 1500) + "… " : text);
}

async function tryTool(toolName: string, input: Record<string, unknown> = {}) {
  try {
    const result = await ciscoClient.callTool(toolName, input);
    print(`${toolName}`, result);
    return result;
  } catch (error) {
    print(`${toolName} (excepción)`, String(error));
    return null;
  }
}

async function main() {
  console.log("=== DIAGNÓSTICO EXTENSIÓN ===");
  await tryTool("getNetwork");
  await tryTool("listDeviceModels");
  await tryTool("validateTopology");
  await tryTool("readDeviceConsole", { deviceName: "Router0", lines: 5 });
  await tryTool("getRoutingTable", { deviceName: "Router0" });
  await tryTool("exportTopologyJSON");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
