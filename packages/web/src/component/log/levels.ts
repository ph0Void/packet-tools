export const NIVELES_LOG_POR_DEFECTO: string[] = [
  "AGENT_TURN",
  "AGENT_PLAN",
  "AGENT_DELEGATION",
  "AGENT_TOOL",
  "AGENT_SKILL",
  "AGENT_RAG",
  "AGENT_APPROVAL",
  "CREATE",
  "LINK",
  "MODULE",
  "CONFIGURE",
  "DELETE",
  "INFO",
  "CRON_EXECUTION",
  "ADMIN_ACTION",
  "ERROR",
];

export const PREFIJO_NIVEL_AGENTE = "AGENT_";

export function esNivelAgente(level?: string | null): boolean {
  return (level ?? "").toUpperCase().startsWith(PREFIJO_NIVEL_AGENTE);
}

export const TONO_NIVEL_DESCONOCIDO =
  "bg-muted text-muted-foreground border-border";

export const TONO_NIVEL_LOG: Record<string, string> = {

  AGENT_TURN: "border-primary/30 bg-primary/10 text-primary",
  AGENT_PLAN: "border-primary/30 bg-primary/10 text-primary",
  AGENT_DELEGATION: "border-primary/30 bg-primary/10 text-primary",
  AGENT_TOOL: "border-primary/30 bg-primary/10 text-primary",
  AGENT_SKILL: "border-primary/30 bg-primary/10 text-primary",
  AGENT_RAG: "border-primary/30 bg-primary/10 text-primary",
  AGENT_APPROVAL: "border-amber-500/30 bg-amber-500/15 text-amber-400",

  CREATE: "border-emerald-500/30 bg-emerald-500/15 text-emerald-400",
  LINK: "border-cyan-500/30 bg-cyan-500/15 text-cyan-400",
  MODULE: "border-teal-500/30 bg-teal-500/15 text-teal-400",
  CONFIGURE: "border-orange-500/30 bg-orange-500/15 text-orange-400",
  DELETE: "border-rose-500/30 bg-rose-500/15 text-rose-400",
  INFO: "border-blue-500/30 bg-blue-500/15 text-blue-400",
  CRON_EXECUTION: "border-violet-500/30 bg-violet-500/15 text-violet-400",
  ADMIN_ACTION: "border-amber-500/30 bg-amber-500/15 text-amber-400",
  ERROR: "border-red-500/30 bg-red-500/15 text-red-500",
};

export function tonoNivelLog(level?: string | null): string {
  return TONO_NIVEL_LOG[(level ?? "").toUpperCase()] ?? TONO_NIVEL_DESCONOCIDO;
}
