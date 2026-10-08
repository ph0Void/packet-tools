export interface SanitizarConsolaOpciones {

  maxLineas?: number;

  maxChars?: number;
}

const ANSI_CSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

const ESC_OTROS_RE = /\x1b[()][0-9A-Za-z]/g;

function aplicarBackspaces(linea: string): string {
  if (!linea.includes("\b")) return linea;
  const chars: string[] = [];
  for (const ch of linea) {
    if (ch === "\b") {
      chars.pop();
    } else {
      chars.push(ch);
    }
  }
  return chars.join("");
}

function resolverRetornos(linea: string): string {
  if (!linea.includes("\r")) return linea;
  const segmentos = linea.split("\r");
  for (let i = segmentos.length - 1; i >= 0; i -= 1) {
    if (segmentos[i].trim() !== "") return segmentos[i];
  }
  return "";
}

function colapsarEcoEscalerita(lineas: string[]): string[] {
  const resultado: string[] = [];
  for (let i = 0; i < lineas.length; i += 1) {
    const previa = resultado.length > 0 ? resultado[resultado.length - 1] : "";
    const esExtension =
      previa !== "" &&
      previa.length < lineas[i].length &&
      lineas[i].startsWith(previa);
    if (esExtension) {

      resultado[resultado.length - 1] = lineas[i];
    } else {
      resultado.push(lineas[i]);
    }
  }
  return resultado;
}

export function sanitizarConsola(
  texto: string,
  opciones: SanitizarConsolaOpciones = {},
): string {
  const maxLineas = Math.max(
    0,
    Math.floor(typeof opciones.maxLineas === "number" ? opciones.maxLineas : 50),
  );
  const maxChars = Math.max(
    0,
    Math.floor(typeof opciones.maxChars === "number" ? opciones.maxChars : 4000),
  );
  if (maxLineas === 0 || maxChars === 0) return "";

  const lineas: string[] = [];
  for (const cruda of String(texto ?? "").split("\n")) {
    let linea = cruda
      .replace(OSC_RE, "")
      .replace(ANSI_CSI_RE, "")
      .replace(ESC_OTROS_RE, "");
    linea = resolverRetornos(linea);
    linea = aplicarBackspaces(linea);
    linea = linea.trim();
    if (!linea) continue;
    lineas.push(linea);
  }

  const colapsadas = colapsarEcoEscalerita(lineas);

  const dedupe: string[] = [];
  for (const linea of colapsadas) {
    if (dedupe.length > 0 && dedupe[dedupe.length - 1] === linea) continue;
    dedupe.push(linea);
  }
  const recortadas = dedupe.slice(-maxLineas);
  return recortadas.join("\n").slice(-maxChars);
}
