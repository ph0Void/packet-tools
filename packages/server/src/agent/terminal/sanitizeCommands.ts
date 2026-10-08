import { classifyCommandRisk } from "@/agent/security/CommandClassifier";
import { CISCO, type VendorProfile } from "@/agent/security/VendorProfile";

export interface SanitizeResult {

  commands: string[];

  removed: string[];

  vendor: string;
}

export function sanitizeCommandsForPrompt(
  commands: string[],
  prompt: string | null,
  profile: VendorProfile = CISCO,
): SanitizeResult {
  const lista = Array.isArray(commands) ? commands : [];

  const lineas = lista.flatMap((command) =>
    String(command ?? "")
      .split(/\r?\n/)
      .map((linea) => linea.trim())
      .filter(Boolean),
  );
  const seguros: string[] = [];
  const removed: string[] = [];

  for (const linea of lineas) {
    try {
      if (classifyCommandRisk(linea, prompt, profile) === "sessionControl") {
        removed.push(linea);
        continue;
      }
    } catch {

      removed.push(linea);
      continue;
    }
    seguros.push(linea);
  }

  return { commands: seguros, removed, vendor: profile.id };
}
