import { CISCO_PACKET_TRACER_TOOLS_ADMIN } from "@/agent/ciscoPacketTracer/Tool";

async function invokeTool(toolName: string, input: Record<string, unknown> = {}) {
  const tool: any = CISCO_PACKET_TRACER_TOOLS_ADMIN.find(
    (t: any) => t.name === toolName,
  );
  if (!tool) return { error: `tool inexistente: ${toolName}` };
  try {
    const output = await tool.invoke(input);
    const obj = typeof output === "string" ? JSON.parse(output) : output;
    return obj && obj.code && obj.result ? obj.result : obj;
  } catch (error: any) {
    return { error: String(error?.message ?? error) };
  }
}

async function main() {
  const models = await invokeTool("listDeviceModels");
  const count = Array.isArray(models?.models) ? models.models.length : -1;
  console.log(`listDeviceModels -> ${count} modelos ${models?.error ? "ERROR: " + models.error : ""}`);

  const networkRes = await invokeTool("getNetwork");
  const net = networkRes?.result ?? networkRes;
  console.log(
    `getNetwork -> dispositivos=${Array.isArray(net?.devices) ? net.devices.length : "?"} enlaces=${Array.isArray(net?.connections) ? net.connections.length : "?"} unresolved=${net?.unresolvedLinks} nullPort=${net?.nullPortLinks}`,
  );
  if (Array.isArray(net?.devices)) {
    console.log("  " + net.devices.map((d: any) => `${d.name}(${d.model},t=${d.type})`).join(", "));
  }
  console.log("FINAL:", JSON.stringify(networkRes).slice(0, 400));
  process.exit(0);
}
main().catch((error) => {
  console.log("ERR", error?.message ?? error);
  process.exit(1);
});
