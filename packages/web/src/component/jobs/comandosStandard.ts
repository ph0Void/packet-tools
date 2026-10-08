export const MAX_COMANDOS_STANDARD = 30;

export const COMANDOS_DE_CIERRE: readonly string[] = [
  "exit",
  "quit",
  "logout",
  "disconnect",
  "close",
];

export interface DispositivoStandard {
  protocol?: string | null;
  typeDevice?: string | null;
}

function normalizarComando(comando: string): string {
  let normalizado = String(comando ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (normalizado.startsWith("do ")) normalizado = normalizado.slice(3).trim();
  return normalizado;
}

function aLista(texto: string | null | undefined): string[] {
  return String(texto ?? "")
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);
}

export function comandosATexto(comandos: readonly string[]): string {
  return (comandos ?? [])
    .map((comando) => String(comando ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

export function extraerComandos(payload: string | null | undefined): string[] {
  const bruto = String(payload ?? "").trim();
  if (!bruto) return [];

  if (bruto.startsWith("{") || bruto.startsWith("[")) {
    try {
      const dato: unknown = JSON.parse(bruto);
      if (Array.isArray(dato)) return aLista(dato.join("\n"));
      if (dato && typeof dato === "object") {
        const contenedor = dato as Record<string, unknown>;
        const fuente =
          contenedor.commands ?? contenedor.comandos ?? contenedor.command;
        if (Array.isArray(fuente)) return aLista(fuente.join("\n"));
        if (typeof fuente === "string") return aLista(fuente);
      }
    } catch {

    }
  }

  return aLista(bruto);
}

export function comandosQueCierranSesion(
  texto: string | null | undefined,
): string[] {
  return aLista(texto).filter((comando) =>
    COMANDOS_DE_CIERRE.includes(normalizarComando(comando)),
  );
}

export function motivoDispositivoNoSoportado(
  dispositivo: DispositivoStandard | null | undefined,
): string | null {
  const protocolo = dispositivo?.protocol ?? "";
  const tipo = dispositivo?.typeDevice ?? "";

  if (protocolo === "SSH" || protocolo === "TELNET" || protocolo === "SERIAL") {
    return null;
  }
  if (protocolo === "SIMULATION" && tipo === "PACKET_TRACER") return null;
  if (protocolo === "SIMULATION" && tipo === "GNS3") {
    return (
      "Las automatizaciones estándar no ejecutan comandos sobre nodos GNS3: " +
      "no hay forma de abrir una sesión de consola contra un nodo de GNS3 " +
      "desde el backend. Usa una automatización inteligente (el agente sí " +
      "sabe operar la topología) o un dispositivo con SSH, Telnet o serie."
    );
  }
  if (protocolo === "SIMULATION") {
    return (
      `Protocolo SIMULATION con tipo de dispositivo '${tipo}' sin ejecución ` +
      "de comandos automática."
    );
  }
  return `Protocolo '${protocolo}' no soportado por las automatizaciones estándar.`;
}

export function admiteComandosStandard(
  dispositivo: DispositivoStandard | null | undefined,
): boolean {
  return motivoDispositivoNoSoportado(dispositivo) === null;
}
