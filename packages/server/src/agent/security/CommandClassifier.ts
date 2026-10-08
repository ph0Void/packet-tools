import { CISCO, type VendorProfile } from "@/agent/security/VendorProfile";

export type CommandLevel = "readonly" | "config";

export type CommandRisk = "safe" | "config" | "dangerous" | "sessionControl";

export interface CommandClassification {

  level: CommandLevel;

  risk: CommandRisk;

  configCommands: string[];

  dangerousCommands: string[];

  sessionCommands: string[];
}

export const READONLY_PREFIXES: readonly string[] = [
  "show",
  "display",
  "ping",
  "ping6",
  "traceroute",
  "tracert",
  "dir",
  "more",
  "type",
  "terminal length",
  "screen-length",
  "who",
  "whoami",
  "where",
  "date",
  "ipconfig",
  "ifconfig",
  "arp",
  "netstat",
  "nslookup",
  "ssh -v",
  "help",
  "?",
];

export interface ReadonlyFamilyPattern {

  familia: string;

  patron: RegExp;
}

const ROUTEROS_PATH = String.raw`\/[\w.-]+(?:[\s/]+[\w.-]+)*`;

export const READONLY_FAMILY_PATTERNS: readonly ReadonlyFamilyPattern[] = [
  {

    familia: "mikrotik/routeros",
    patron: new RegExp(String.raw`^${ROUTEROS_PATH}\s+print\b`),
  },
  {

    familia: "mikrotik/routeros",
    patron: /^print\b/,
  },
  {

    familia: "mikrotik/routeros",
    patron: /^\/export(?!.*\bfile=)/,
  },
  {
    familia: "mikrotik/routeros",
    patron: /^export\b(?!.*\bfile=)/,
  },
  {

    familia: "mikrotik/routeros",
    patron: new RegExp(String.raw`^${ROUTEROS_PATH}\s+ping\b`),
  },
  {

    familia: "fortios/vyos",
    patron: /^get\b/,
  },
];

export const DANGEROUS_PATTERNS: readonly (string | RegExp)[] = [
  "reload",
  "reboot",
  "/system reboot",
  "write erase",
  /^wr\s+erase/,
  "erase",
  "erase startup-config",
  "erase nvram",
  "reset",
  "/system reset-configuration",
  "factory-reset",
  "factory-default",
  "format",
  "delete",
  "boot system",
];

const SESSION_CONTROL_COMMANDS: readonly string[] = [
  "exit",
  "quit",
  "logout",
  "disconnect",
  "close",
];

const NESTED_PROMPT_ALLOWED: readonly string[] = ["exit", "quit"];

const RISK_PRIORITY: Record<CommandRisk, number> = {
  safe: 0,
  config: 1,
  sessionControl: 2,
  dangerous: 3,
};

function normalizeCommand(command: string): string {
  let normalized = String(command ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  if (normalized.startsWith("do ")) normalized = normalized.slice(3).trim();
  return normalized;
}

function matchesPrefix(normalized: string, prefix: string): boolean {

  if (prefix.endsWith(" ")) return normalized.startsWith(prefix);
  return normalized === prefix || normalized.startsWith(`${prefix} `);
}

export function matchesReadonly(normalized: string): boolean {
  if (!normalized) return false;
  for (const prefix of READONLY_PREFIXES) {
    if (matchesPrefix(normalized, prefix)) return true;
  }
  return READONLY_FAMILY_PATTERNS.some(({ patron }) => patron.test(normalized));
}

export function isNestedPrompt(
  prompt?: string | null,
  profile: VendorProfile = CISCO,
): boolean {
  return profile.prompt.isNested(prompt);
}

function matchesDangerousPattern(normalized: string): boolean {
  if (!normalized) return false;
  return DANGEROUS_PATTERNS.some((pattern) =>
    pattern instanceof RegExp
      ? pattern.test(normalized)
      : matchesPrefix(normalized, pattern),
  );
}

function isDangerousCommand(command: string): boolean {
  if (matchesDangerousPattern(normalizeCommand(command))) return true;
  for (const line of String(command ?? "").split(/\r?\n/)) {
    if (matchesDangerousPattern(normalizeCommand(line))) return true;
  }
  return false;
}

export function classifyCommand(command: string): CommandLevel {
  const raw = String(command ?? "");

  if (raw.includes("\r") || raw.includes("\n")) return "config";
  const normalized = normalizeCommand(raw);
  if (!normalized) return "config";

  if (isDangerousCommand(raw)) return "config";
  return matchesReadonly(normalized) ? "readonly" : "config";
}

function classifySingleLineRisk(
  line: string,
  prompt?: string | null,
  profile?: VendorProfile,
): CommandRisk {
  if (isDangerousCommand(line)) return "dangerous";

  const normalized = normalizeCommand(line);
  if (SESSION_CONTROL_COMMANDS.includes(normalized)) {

    if (
      NESTED_PROMPT_ALLOWED.includes(normalized) &&
      isNestedPrompt(prompt, profile)
    ) {
      return "safe";
    }
    return "sessionControl";
  }

  if (!normalized) return "config";
  return matchesReadonly(normalized) ? "safe" : "config";
}

export function classifyCommandRisk(
  command: string,
  prompt?: string | null,
  profile?: VendorProfile,
): CommandRisk {
  const raw = String(command ?? "");

  if (!raw.includes("\r") && !raw.includes("\n")) {
    return classifySingleLineRisk(raw, prompt, profile);
  }

  const lineas = raw
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);

  let riesgo: CommandRisk = "config";
  for (const linea of lineas) {
    const riesgoLinea = classifySingleLineRisk(linea, prompt, profile);
    if (RISK_PRIORITY[riesgoLinea] > RISK_PRIORITY[riesgo]) {
      riesgo = riesgoLinea;
    }
  }
  return riesgo;
}

export function classifyCommands(
  commands: string[],
  prompt?: string | null,
  profile?: VendorProfile,
): CommandClassification {
  const list = Array.isArray(commands) ? commands : [];
  const configCommands: string[] = [];
  const dangerousCommands: string[] = [];
  const sessionCommands: string[] = [];
  let risk: CommandRisk = "safe";

  for (const command of list) {
    if (classifyCommand(command) === "config") configCommands.push(command);

    const lineas = String(command ?? "")
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter(Boolean);

    for (const linea of lineas) {
      const riesgoLinea = classifySingleLineRisk(linea, prompt, profile);
      if (riesgoLinea === "dangerous") dangerousCommands.push(linea);
      if (riesgoLinea === "sessionControl") sessionCommands.push(linea);
    }

    const commandRisk = classifyCommandRisk(command, prompt, profile);
    if (RISK_PRIORITY[commandRisk] > RISK_PRIORITY[risk]) risk = commandRisk;
  }

  const level: CommandLevel =
    list.length > 0 && configCommands.length === 0 ? "readonly" : "config";
  return { level, risk, configCommands, dangerousCommands, sessionCommands };
}
