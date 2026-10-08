import { BASE_SUPERVISOR_PROMPT } from "../DeepSupervisor";
import { TOOL_POLICIES } from "../../security/ToolPolicy";
import { estimarTokens } from "../metrics";
import { envConfig } from "@/config/EnvConfig";

const LEGACY_SUPERVISOR_TOOLS = [
  "search_knowledge_base",
  "search_web_tool",
  "transfer_to_cisco_packet_tracer",
  "transfer_to_gns3",
  "transfer_to_ssh",
  "transfer_to_telnet",
  "transfer_to_serial",
];

const DEEP_SUPERVISOR_TOOLS = [
  "ls",
  "read_file",
  "write_file",
  "edit_file",
  "glob",
  "grep",
  "task",
  "write_todos",
  "search_knowledge_base",
  "search_web_tool",
];

const TOKENS_POR_TOOL = 120;

const SUBAGENTES = [
  "packet_tracer_specialist",
  "gns3_specialist",
  "ssh_specialist",
  "telnet_specialist",
  "serial_specialist",
  "knowledge_specialist",
  "system_admin_specialist",
  "general-purpose",
];

const SKILLS_EJEMPLO = 10;

const BLOQUE_CONEXION =
  "## Target connection of this turn\n" +
  "- Device: R1-core | Protocol: SSH | Type: CISCO | State: console alive\n" +
  "- Routing is automatic per protocol: never ask the user which specialist to use.\n" +
  "- Operate ONLY on that device console; do not open parallel connections.";

const DIGEST_ESPECIALISTA = `SSH: ${"Salida del especialista con el resultado de la operación. ".repeat(20)}`;

export interface PromptBreakdown {
  arquitectura: string;
  systemPrompt: number;
  tools: number;
  catalogoSkills: number;
  catalogoSubagentes: number;

  contexto: number;
  total: number;
}

function medirSystemPrompt(legacy: boolean): number {
  const base = estimarTokens(BASE_SUPERVISOR_PROMPT);
  if (!legacy) return base;

  return base + estimarTokens(BLOQUE_CONEXION) + estimarTokens(DIGEST_ESPECIALISTA);
}

function medirCatalogoSkills(): number {

  return SKILLS_EJEMPLO * estimarTokens(
    "- configurar-ospf-area-0 (/skills/configurar-ospf-area-0/SKILL.md): Configura OSPF área 0 entre dos routers y verifica la vecindad",
  );
}

function medirCatalogoSubagentes(): number {
  return SUBAGENTES.length * estimarTokens(
    "- packet_tracer_specialist: Topologías y dispositivos en Cisco Packet Tracer, simulación de PDUs y diagnóstico.",
  );
}

function medirContextoEspecialista(legacy: boolean): number {
  if (!legacy) {

    return estimarTokens(
      "Configura OSPF área 0 en R1-core y verifica la vecindad con R2-edge. El dispositivo ya tiene una consola abierta y acepta configuración.",
    );
  }
  return Math.min(
    envConfig.AGENT_CONTEXT_TOKENS,
    envConfig.AGENT_HISTORY_MESSAGES * estimarTokens(DIGEST_ESPECIALISTA),
  );
}

export function compararPrompts(): PromptBreakdown[] {
  const legacySystem = medirSystemPrompt(true);
  const legacyTools =
    estimarTokens(LEGACY_SUPERVISOR_TOOLS.join(" ")) +
    LEGACY_SUPERVISOR_TOOLS.length * TOKENS_POR_TOOL;
  const legacyContexto = medirContextoEspecialista(true);

  const deepSystem = medirSystemPrompt(false);
  const deepTools =
    estimarTokens(DEEP_SUPERVISOR_TOOLS.join(" ")) +
    DEEP_SUPERVISOR_TOOLS.length * TOKENS_POR_TOOL;
  const deepContexto = medirContextoEspecialista(false);

  return [
    {
      arquitectura: "legacy (StateGraph)",
      systemPrompt: legacySystem,
      tools: legacyTools,
      catalogoSkills: 0,
      catalogoSubagentes: 0,
      contexto: legacyContexto,
      total: legacySystem + legacyTools + legacyContexto,
    },
    {
      arquitectura: "deep (createDeepAgent)",
      systemPrompt: deepSystem,
      tools: deepTools,
      catalogoSkills: medirCatalogoSkills(),
      catalogoSubagentes: medirCatalogoSubagentes(),
      contexto: deepContexto,
      total:
        deepSystem +
        deepTools +
        medirCatalogoSkills() +
        medirCatalogoSubagentes() +
        deepContexto,
    },
  ];
}

export function superficieAprobacion(): { total: number; reversibles: number } {
  const entradas = Object.entries(TOOL_POLICIES).filter(
    ([, policy]) => policy.access === "mutating",
  );
  return {
    total: entradas.length,
    reversibles: entradas.filter(([, p]) => p.autoApprove).length,
  };
}

if (process.argv[1]?.includes("PromptSize")) {
  const [legacy, deep] = compararPrompts();
  console.log("=== Coste de un turno con delegación (tokens estimados) ===");
  for (const fila of [legacy, deep]) {
    console.log(`\n${fila.arquitectura}`);
    console.log(`  system prompt:       ${fila.systemPrompt}`);
    console.log(`  tools declaradas:   ${fila.tools}`);
    console.log(`  catálogo skills:    ${fila.catalogoSkills}`);
    console.log(`  catálogo subagentes:${fila.catalogoSubagentes}`);
    console.log(`  contexto delegado:  ${fila.contexto}`);
    console.log(`  TOTAL:              ${fila.total}`);
  }
  const delta = Math.round(((deep.total - legacy.total) / legacy.total) * 100);
  console.log(`\nDiferencia en el turno del supervisor: ${delta > 0 ? "+" : ""}${delta}%`);

  const hitl = superficieAprobacion();
  console.log(
    `\nHITL: ${hitl.total} tools mutantes (${hitl.reversibles} reversibles sin confirmación, ${hitl.total - hitl.reversibles} requieren aprobación).`,
  );
}
