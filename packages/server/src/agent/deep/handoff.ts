const SUBAGENT_TO_HANDOFF: Record<string, string> = {
  packet_tracer_specialist: "packet_tracer",
  gns3_specialist: "gns3",
  ssh_specialist: "ssh",
  telnet_specialist: "telnet",
  serial_specialist: "serial",
  knowledge_specialist: "knowledge",
  system_admin_specialist: "system_admin",
  "general-purpose": "general",
};

export const TASK_TOOL_NAME = "task";

export function resolveHandoffTarget(
  toolName: string,
  input: unknown,
): string | null {
  if (toolName !== TASK_TOOL_NAME) return null;
  const subagentType = (input as { subagent_type?: unknown } | null)?.subagent_type;
  if (typeof subagentType !== "string") return null;
  return SUBAGENT_TO_HANDOFF[subagentType] ?? subagentType;
}

export function resolveTaskBrief(input: unknown): string {
  const description = (input as { description?: unknown } | null)?.description;
  return typeof description === "string" ? description : "";
}

export const KNOWN_SUBAGENTS = Object.keys(SUBAGENT_TO_HANDOFF);
