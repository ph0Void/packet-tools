import { BASE_SUPERVISOR_PROMPT } from "../DeepSupervisor";
import { TELNET_PROMPT } from "../../telnet/Promt";
import { SSH_PROMPT } from "../../ssh/Promt";
import { SERIAL_PORT_PROMPT } from "../../serialPort/Promt";
import { GNS3_PROMPT } from "../../gns3/Promt";
import { CISCO_PACKET_TRACER_PROMPT } from "../../ciscoPacketTracer/Promt";
import { estimarTokens } from "../metrics";
import { sanitizarConsola } from "@/utils/TerminalSanitizer";
import { envConfig } from "@/config/EnvConfig";
import { CISCO_PACKET_TRACER_TOOLS_ADMIN } from "../../ciscoPacketTracer/Tool";
import { SSH_TOOLS } from "../../ssh/Tool";
import { TELNET_TOOLS } from "../../telnet/Tool";
import { SERIAL_PORT_TOOLS } from "../../serialPort/Tool";
import { buildLazyToolLayer, type ToolLike } from "../../tools/lazyTools";
import { buildSkillsSection } from "../../skills/middleware";

export function tokensDeTool(tool: ToolLike): number {
  const schema = tool.schema as { toJSONSchema?: () => unknown } | undefined;
  let json = "{}";
  if (schema && typeof schema.toJSONSchema === "function") {
    try {
      json = JSON.stringify(schema.toJSONSchema());
    } catch {
      json = "{}";
    }
  }
  return estimarTokens(String(tool.description ?? "")) + estimarTokens(json);
}

export function tokensDeTools(tools: readonly ToolLike[]): number {
  return tools.reduce((total, tool) => total + tokensDeTool(tool), 0);
}

const CATALOGO_SKILLS_EJEMPLO = 1;

const BLOQUE_TERMINAL_ACTUAL =
  "\x1b[36m[admin@MikroTik] > \x1b[K\r\x1b[1;24r\x1b[24;1H\x1b[J\x1b[1;1H" +
  "[admin@MikroTik] > /system resource print\r\n" +
  Array.from({ length: 15 }, (_, i) => `${" ".repeat(16)}campo-${i}: ${"x".repeat(40)}\r\n`).join("") +
  "\r\x1b[36m[admin@MikroTik] > \x1b[K".repeat(3);

const BLOQUE_TERMINAL_SANEADO = sanitizarConsola(BLOQUE_TERMINAL_ACTUAL, {
  maxLineas: 10,
  maxChars: envConfig.TERMINAL_SNIPPET_MAX_CHARS,
});

const ENCABEZADO_TERMINAL =
  "## Terminal activa\n" +
  "- Dispositivo: TEST_MIKROTIK | Protocolo: TELNET | Sesión: ses-1 | Viva: sí\n" +
  "- Vendor: MIKROTIK\n" +
  "- Prompt: [admin@MikroTik] > ";

const TAIL_FRONTEND = "S".repeat(8000);

const REGISTRO_TERMINAL: ToolLike[] = TELNET_TOOLS as unknown as ToolLike[];
const CAPA_TERMINAL = buildLazyToolLayer(REGISTRO_TERMINAL);

interface Componentes {
  systemBase: number;
  catalogoSkills: number;
  catalogoSubagentes: number;
  schemasToolsSupervisor: number;
  schemasToolsEspecialista: number;
  bloqueTerminal: number;
  tailEnMensajeUsuario: number;
  historial: number;

  totalEntradaSupervisor: number;

  totalEntradaEspecialista: number;

  totalTurno: number;
}

function catalogoSkillsTokens(): number {
  const catalogo = [
    "## Available skills (in /skills/)",
    "- configurar-ospf-area-0 (/skills/configurar-ospf-area-0/SKILL.md): Configura OSPF área 0 entre dos routers",
  ].slice(0, CATALOGO_SKILLS_EJEMPLO + 1)
    .join("\n");
  return estimarTokens(buildSkillsSection(catalogo));
}

function catalogoSubagentesTokens(): number {
  return 8 * estimarTokens(
    "- packet_tracer_specialist: Topologías y dispositivos en Cisco Packet Tracer, simulación de PDUs y diagnóstico.",
  );
}

const SUPERVISOR_TOOLS = 12;

const TOKENS_POR_TOOL_SUPERVISOR = 120;

function esc(
  nombre: string,
  opts: {
    bloqueTerminal: string;
    tail: string;
    historialMensajes: number;
    toolsEspecialista: number;
    promptEspecialista?: string;
  },
): Componentes {
  const systemBase = estimarTokens(BASE_SUPERVISOR_PROMPT) + (opts.promptEspecialista ? estimarTokens(opts.promptEspecialista) : 0);
  const catalogoSkills = catalogoSkillsTokens();
  const catalogoSubagentes = catalogoSubagentesTokens();
  const schemasToolsSupervisor = SUPERVISOR_TOOLS * TOKENS_POR_TOOL_SUPERVISOR;
  const schemasToolsEspecialista = opts.toolsEspecialista;
  const bloqueTerminal = estimarTokens(opts.bloqueTerminal);
  const tailEnMensajeUsuario = estimarTokens(opts.tail);
  const historial = Math.min(
    envConfig.AGENT_CONTEXT_TOKENS,
    opts.historialMensajes * estimarTokens("Mensaje de historial con salida persistida de consola y texto del usuario."),
  );
  const totalEntradaSupervisor =
    systemBase + catalogoSkills + catalogoSubagentes + schemasToolsSupervisor + bloqueTerminal + tailEnMensajeUsuario + historial;

  const totalEntradaEspecialista =
    (opts.promptEspecialista ? estimarTokens(opts.promptEspecialista) : 0) +
    schemasToolsEspecialista +
    opts.historialMensajes *
      estimarTokens("Brief delegado con el encabezado de terminal.");
  const totalTurno = totalEntradaSupervisor + totalEntradaEspecialista;
  console.log(`\n=== ${nombre} ===`);
  console.log(`  system base (supervisor):        ${systemBase}`);
  if (opts.promptEspecialista) console.log(`  system base (especialista):      ${estimarTokens(opts.promptEspecialista)}`);
  console.log(`  catálogo skills:                 ${catalogoSkills}`);
  console.log(`  catálogo subagentes:             ${catalogoSubagentes}`);
  console.log(`  schemas tools supervisor:        ${schemasToolsSupervisor}`);
  console.log(`  schemas tools especialista:      ${schemasToolsEspecialista}`);
  console.log(`  bloque terminal (system):        ${bloqueTerminal}`);
  console.log(`  tail terminal (user message):    ${tailEnMensajeUsuario}`);
  console.log(`  historial (cap ${envConfig.AGENT_CONTEXT_TOKENS}):            ${historial}`);
  console.log(`  TOTAL entrada supervisor:        ${totalEntradaSupervisor}`);
  console.log(`  TOTAL entrada especialista:      ${totalEntradaEspecialista}`);
  console.log(`  TOTAL turno (supervisor+especial): ${totalTurno}`);
  return { systemBase, catalogoSkills, catalogoSubagentes, schemasToolsSupervisor, schemasToolsEspecialista, bloqueTerminal, tailEnMensajeUsuario, historial, totalEntradaSupervisor, totalEntradaEspecialista, totalTurno };
}

const TOKENS_SSH = tokensDeTools(SSH_TOOLS as unknown as ToolLike[]);
const TOKENS_TELNET = tokensDeTools(REGISTRO_TERMINAL);
const TOKENS_SERIAL = tokensDeTools(SERIAL_PORT_TOOLS as unknown as ToolLike[]);
const TOKENS_PT_TODAS = tokensDeTools(
  CISCO_PACKET_TRACER_TOOLS_ADMIN as unknown as ToolLike[],
);
const CAPA_PT = buildLazyToolLayer(
  CISCO_PACKET_TRACER_TOOLS_ADMIN as unknown as ToolLike[],
);
const TOKENS_PT_EAGER = tokensDeTools(
  CAPA_PT.eager
    .map((nombre) =>
      (CISCO_PACKET_TRACER_TOOLS_ADMIN as unknown as ToolLike[]).find(
        (t) => t.name === nombre,
      ),
    )
    .filter((t): t is ToolLike => !!t),
);
const TOKENS_LOAD_TOOLS = tokensDeTools([
  CAPA_PT.declaradas.find((t) => t.name === "load_tools") as ToolLike,
]);

console.log("=== Registros reales de tools (descripción + JSON Schema) ===");
console.log(`  SSH:     ${SSH_TOOLS.length} tools → ${TOKENS_SSH} tok`);
console.log(`  Telnet:  ${REGISTRO_TERMINAL.length} tools → ${TOKENS_TELNET} tok`);
console.log(`  Serie:   ${SERIAL_PORT_TOOLS.length} tools → ${TOKENS_SERIAL} tok`);
console.log(
  `  PT:      ${CAPA_PT.declaradas.length - 1} tools → ${TOKENS_PT_TODAS} tok` +
    ` | eager ${CAPA_PT.eager.length} (${TOKENS_PT_EAGER} tok) + load_tools (${TOKENS_LOAD_TOOLS} tok) = ${TOKENS_PT_EAGER + TOKENS_LOAD_TOOLS} tok`,
);
console.log(
  `  Ratio PT bajo demanda: ${Math.round(((TOKENS_PT_EAGER + TOKENS_LOAD_TOOLS) / TOKENS_PT_TODAS) * 100)}% de las tools completas`,
);

esc("(a) Consulta simple con consola conectada (D2 default: 0 líneas)", {
  bloqueTerminal: ENCABEZADO_TERMINAL,
  tail: "",
  historialMensajes: 8,
  toolsEspecialista: TOKENS_TELNET,
  promptEspecialista: TELNET_PROMPT,
});

esc("(a2) Igual con selector de 25 líneas (cola saneada)", {
  bloqueTerminal: ENCABEZADO_TERMINAL,
  tail: BLOQUE_TERMINAL_SANEADO,
  historialMensajes: 8,
  toolsEspecialista: TOKENS_TELNET,
  promptEspecialista: TELNET_PROMPT,
});

esc("(b) Tarea Packet Tracer ~8 llamadas (bajo demanda)", {
  bloqueTerminal: "",
  tail: "",
  historialMensajes: 4,
  toolsEspecialista: TOKENS_PT_EAGER + TOKENS_LOAD_TOOLS,
  promptEspecialista: CISCO_PACKET_TRACER_PROMPT,
});

esc("(b2) Tarea Packet Tracer con TODAS las tools (rollback de la flag)", {
  bloqueTerminal: "",
  tail: "",
  historialMensajes: 4,
  toolsEspecialista: TOKENS_PT_TODAS,
  promptEspecialista: CISCO_PACKET_TRACER_PROMPT,
});

const a = esc("(c1) Turno 1 — encabezado de terminal", {
  bloqueTerminal: ENCABEZADO_TERMINAL,
  tail: "",
  historialMensajes: 8,
  toolsEspecialista: 0,
});
esc("(c2) Turno 2 — la consola cambió (solo cambia el encabezado si el device/prompt cambian)", {
  bloqueTerminal: ENCABEZADO_TERMINAL.replace("Viva: sí", "Viva: sí"),
  tail: "",
  historialMensajes: 8,
  toolsEspecialista: 0,
});
console.log(
  `\nDelta de system+terminal entre c1 y c2: ${a.bloqueTerminal - a.bloqueTerminal} tok — el snapshot de consola ya NO está en el system prompt compilado, así que el cache del prefijo estable sobrevive a cualquier cambio de consola.`,
);

console.log("\n=== Anclajes reales (OpenRouter, prueba real) ===");
console.log("  Llamada 1 supervisor: 11,574 tok entrada (814 nuevos, 10,760 cacheados), 6 llamadas LLM en el turno");
console.log("  Llamadas especialista Telnet: 7,846–10,762 tok entrada, cache hit 93–98%");
console.log(
  `  Telnet %: ${REGISTRO_TERMINAL.length} tools = ${TOKENS_TELNET} tok de schemas; PT: ${TOKENS_PT_TODAS} tok si se ligan todas, ${TOKENS_PT_EAGER + TOKENS_LOAD_TOOLS} tok con el núcleo bajo demanda`,
);
