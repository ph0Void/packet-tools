import { CISCO_PACKET_TRACER_TOOLS_ADMIN } from "@/agent/ciscoPacketTracer/Tool";

function unwrap(value: unknown): any {
  let current: any = value;
  for (let i = 0; i < 6; i++) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    const keys = Object.keys(current);
    const isWrapper = "code" in current && "result" in current;
    const onlyResult =
      keys.length === 1 &&
      keys[0] === "result" &&
      typeof current.result === "object";
    console.log(
      `nivel ${i}: claves=[${keys.slice(0, 8).join(",")}] envoltorio=${isWrapper} soloResultado=${onlyResult}`,
    );
    if (!isWrapper && !onlyResult) break;
    current = current.result;
  }
  return current;
}

async function main() {
  const tool: any = CISCO_PACKET_TRACER_TOOLS_ADMIN.find(
    (t: any) => t.name === "getNetwork",
  );
  const output = await tool.invoke({});
  const obj = typeof output === "string" ? JSON.parse(output) : output;
  const final = unwrap(obj);
  console.log(
    "FINAL claves:",
    Object.keys(final).join(","),
    "| devices:",
    Array.isArray(final?.devices) ? final.devices.length : typeof final?.devices,
    "| connectionCount:",
    final?.connectionCount,
  );
  console.log("RAW fin:", JSON.stringify(obj).slice(-260));
  process.exit(0);
}
main().catch((error) => {
  console.log("ERR", error.message);
  process.exit(1);
});
