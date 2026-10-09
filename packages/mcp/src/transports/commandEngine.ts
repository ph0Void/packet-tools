/**
 * Motor de comandos común a todos los transportes.
 *
 * QUÉ PROBLEMA RESUELVE
 * El servidor tenía tres clientes de terminal y cada uno resolvía por su cuenta
 * lo mismo: sanear los comandos para no cerrar la consola por accidente, esperar
 * a que la salida se estabilice y recortar el resultado. Aquí eso vive una sola
 * vez y los adaptadores solo aportan "hablar el protocolo".
 *
 * DETECCIÓN DE FABRICANTE (requisito central)
 * Se reimplementa el criterio de `packages/server/src/agent/security/VendorProfile.ts`
 * porque es dato puro y probado (Cisco IOS, Huawei VRP, MikroTik RouterOS,
 * ArubaOS, JunOS y un perfil conservador). Se consulta en este orden:
 *   1. El tipo declarado del equipo (`typeDevice` de la BD propia del MCP).
 *   2. El prompt leído de la consola, con reglas ordenadas de más a menos
 *      específica.
 *   3. Perfil conservador.
 * El perfil decide QUÉ comandos de transición se pueden enviar: si no se conoce
 * el comando, no se inventa (es preferible no tocar la consola que teclearle a
 * un equipo un comando que no existe).
 */
import type { DeviceTransport, OpcionesEjecucion, ResultadoComando } from "./DeviceTransport";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";

// ---------------------------------------------------------------------------
// Perfiles de fabricante (datos puros)
// ---------------------------------------------------------------------------

/** Identificadores de fabricante soportados. */
export type VendorId = "cisco" | "huawei" | "mikrotik" | "aruba" | "junos" | "conservative";

/** Perfil de un fabricante: cómo se ve su prompt y cómo se transiciona. */
interface PerfilVendor {
  id: VendorId;
  label: string;
  /** Prompt que indica sub-modo de configuración anidado. */
  esSubModo: (linea: string) => boolean;
  /** ¿La línea es un prompt de este fabricante? */
  esPrompt: (linea: string) => boolean;
  transiciones: {
    aUsuario: string | null;
    aPrivilegiado: string | null;
    aConfig: string | null;
    guardarConfig: string | null;
    salirDeConfig: string | null;
  };
  preambulo: {
    sinPaginacion: string | null;
  };
  paginador: RegExp[];
}

/** Longitud máxima que se considera un prompt (no una línea de salida). */
const PROMPT_MAX_CHARS = 120;

/** Limpia una línea para compararla como prompt: sin ANSI, sin CR. */
function limpiar(linea?: string | null): string {
  return String(linea ?? "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r/g, "")
    .trim();
}

/** ¿La línea tiene forma de prompt corto? */
function parecePrompt(linea: string): boolean {
  const texto = limpiar(linea);
  return texto.length > 0 && texto.length <= PROMPT_MAX_CHARS;
}

// --- Cisco IOS -------------------------------------------------------------
const CISCO: PerfilVendor = {
  id: "cisco",
  label: "Cisco IOS",
  esSubModo: (linea) => /\)#$/.test(limpiar(linea)),
  esPrompt: (linea) => {
    const texto = limpiar(linea);
    return parecePrompt(texto) && /[#>]\s*$/.test(texto);
  },
  transiciones: {
    aUsuario: "disable",
    aPrivilegiado: "enable",
    aConfig: "configure terminal",
    guardarConfig: "write memory",
    // `disable` NO sirve dentro de `(config)#`; la salida es `exit`.
    salirDeConfig: "exit",
  },
  preambulo: { sinPaginacion: "terminal length 0" },
  paginador: [/--More--/, /\(END\)/],
};

// --- Huawei VRP ------------------------------------------------------------
const HUAWEI_VISTA = /^\[[^\]]*\]\s*$/;
const HUAWEI: PerfilVendor = {
  id: "huawei",
  label: "Huawei VRP",
  // En VRP un sub-modo separa la vista del dispositivo con `-` o `/`.
  esSubModo: (linea) => /^\[[^\]]*[-/][^\]]*\]\s*$/.test(limpiar(linea)),
  esPrompt: (linea) => {
    const texto = limpiar(linea);
    if (!parecePrompt(texto)) return false;
    return HUAWEI_VISTA.test(texto) || /^<[^<>]+>\s*$/.test(texto);
  },
  transiciones: {
    aUsuario: "quit",
    // En VRP no hay prompt de privilegio separado.
    aPrivilegiado: null,
    aConfig: "system-view",
    guardarConfig: "save",
    salirDeConfig: "quit",
  },
  preambulo: { sinPaginacion: "screen-length 0 temporary" },
  paginador: [/----\s*More\s*----/, /\(END\)/],
};

// --- MikroTik RouterOS -----------------------------------------------------
const MIKROTIK_RAIZ = /^\[[^\]]*@[^\]]*\]\s*[>\/]?\s*$/;
const MIKROTIK_MENU = /^\[[^\]]*@[^\]]*\]\s*\/\S+/;
/**
 * Ruta de menú: identidad + `/ruta` + `>` final.
 * RouterOS no tiene modo de configuración global (todo se edita dentro de un
 * menú), así que lo único que dice "estoy dentro" es la barra en el prompt.
 */
const MIKROTIK_RUTA_MENU = /^\[[^\]]*@[^\]]*\]\s*\/\S[^>]*>\s*$/;
const MIKROTIK: PerfilVendor = {
  id: "mikrotik",
  label: "MikroTik RouterOS",
  esSubModo: (linea) => MIKROTIK_MENU.test(limpiar(linea)),
  esPrompt: (linea) => {
    const texto = limpiar(linea);
    return parecePrompt(texto) && (MIKROTIK_RAIZ.test(texto) || MIKROTIK_MENU.test(texto));
  },
  transiciones: {
    aUsuario: "/exit",
    aPrivilegiado: null,
    // null y se queda en null: no hay palabra que "entre" en configuración.
    // Inventar un `configure` sería escribir una ruta que no existe.
    aConfig: null,
    guardarConfig: null,
    // La ayuda del propio equipo dice que para subir un nivel es `..`.
    salirDeConfig: "..",
  },
  preambulo: { sinPaginacion: null },
  paginador: [/\[Q\s*\|\s*quit\]/, /\(END\)/],
};

// --- ArubaOS ---------------------------------------------------------------
const ARUBA_PROMPT = /^\([^()]*\)(\s+\([^()]*\))*\s*[#>]\s*$/;
const ARUBA: PerfilVendor = {
  id: "aruba",
  label: "ArubaOS",
  esSubModo: (linea) => {
    const texto = limpiar(linea);
    if (!ARUBA_PROMPT.test(texto)) return false;
    const grupos = texto.match(/\([^()]*\)/g) ?? [];
    return grupos.length >= 2 || /\(\s*config[^()]*\)/i.test(texto);
  },
  esPrompt: (linea) => {
    const texto = limpiar(linea);
    return parecePrompt(texto) && ARUBA_PROMPT.test(texto);
  },
  transiciones: {
    aUsuario: "exit",
    aPrivilegiado: "enable",
    aConfig: "configure terminal",
    guardarConfig: null, // no confirmado
    salirDeConfig: "exit",
  },
  preambulo: { sinPaginacion: null },
  paginador: [/--More--/, /\(END\)/],
};

// --- JunOS -----------------------------------------------------------------
const JUNOS_PROMPT = /^\S+@\S+[>#]\s*$/;
/**
 * Prompt de Junos para DECIDIR fabricante: más estricto que el operativo.
 * Un shell de Linux también es `algo@algo#` (`root@vyos:~#`); lo que distingue a
 * Junos es que el marcador va pegado al NOMBRE del equipo, sin `:` ni `/`.
 */
const JUNOS_HOST_PROMPT = /^\S+@\S*[A-Za-z0-9][>#]\s*$/;
const JUNOS_SUBMODO = /^\s*\[(?:edit|configure|top)[^\]]*\]\s*$/;
const JUNOS: PerfilVendor = {
  id: "junos",
  label: "Juniper JunOS",
  esSubModo: (linea) => JUNOS_SUBMODO.test(limpiar(linea)),
  esPrompt: (linea) => {
    const texto = limpiar(linea);
    return parecePrompt(texto) && JUNOS_PROMPT.test(texto);
  },
  transiciones: {
    aUsuario: "exit",
    aPrivilegiado: null,
    aConfig: "configure",
    guardarConfig: "commit",
    salirDeConfig: "exit",
  },
  preambulo: { sinPaginacion: "set cli screen-length 0" },
  paginador: [/--More--/, /-{2,}\s*\(\s*more\s*\)\s*-{2,}/, /\(END\)/],
};

// --- Conservador -----------------------------------------------------------
const GENERICO_PROMPT = /[#>]\s*$/;
const GENERICO_PROMPT_ANIDADO = /\([^()]*\)\s*[#>]\s*$|^\s*\[[^\]]+\]\s*$/;
const CONSERVADOR: PerfilVendor = {
  id: "conservative",
  label: "Genérico (fabricante no identificado)",
  esSubModo: (linea) => {
    const texto = limpiar(linea);
    if (!parecePrompt(texto)) return false;
    if (/^\[[^\]]*@[^\]]*\]\s*\/\S+/.test(texto)) return true;
    if (/^\[(?!.*@)[^\]]+\]\s*[>#]?\s*$/.test(texto)) return true;
    return false;
  },
  esPrompt: (linea) => {
    const texto = limpiar(linea);
    if (!parecePrompt(texto)) return false;
    if (/^\[[^\]]*@[^\]]*\]\s*\/\S+/.test(texto)) return true;
    if (/[#>\]]$/.test(texto)) return true;
    const ultimo = texto.split(/\s+/).pop() ?? "";
    return /[$%>]$/.test(ultimo);
  },
  transiciones: {
    // Sin fabricante conocido NO se transiciona: mejor no tocar la consola que
    // enviar un comando que no existe en ese sistema.
    aUsuario: null,
    aPrivilegiado: null,
    aConfig: null,
    guardarConfig: null,
    salirDeConfig: null,
  },
  preambulo: { sinPaginacion: null },
  paginador: [/--More--/, /----\s*More\s*----/, /\(END\)/],
};

/** Todos los perfiles por id. */
export const PERFILES_VENDOR: Record<VendorId, PerfilVendor> = {
  cisco: CISCO,
  huawei: HUAWEI,
  mikrotik: MIKROTIK,
  aruba: ARUBA,
  junos: JUNOS,
  conservative: CONSERVADOR,
};

/**
 * Deduce el fabricante SOLO a partir del prompt.
 * Reglas ordenadas de más a menos específica; devuelve null si el prompt no es
 * concluyente (es preferible el perfil conservador a un fabricante equivocado).
 */
export function detectarVendorPorPrompt(prompt?: string | null): VendorId | null {
  const texto = limpiar(prompt);
  if (!parecePrompt(texto)) return null;

  if (MIKROTIK_RAIZ.test(texto) || MIKROTIK_MENU.test(texto)) return "mikrotik";
  if (JUNOS_SUBMODO.test(texto) || JUNOS_HOST_PROMPT.test(texto)) return "junos";
  if (HUAWEI_VISTA.test(texto) || /^<[^<>]+>\s*$/.test(texto)) return "huawei";
  if (ARUBA_PROMPT.test(texto)) return "aruba";
  if (/\(config[^)]*\)#\s*$/.test(texto)) return "cisco";

  // `R1#`, `switch#`, `vyos@vyos:~$` no identifican a nadie por sí solos.
  return null;
}

/**
 * Resuelve el perfil en tres niveles: declarado → detectado → conservador.
 * Es la misma semántica que el servidor, para que el comportamiento coincida.
 */
export function resolverVendor(input: {
  typeDevice?: string | null;
  prompt?: string | null;
}): PerfilVendor {
  const declarado = String(input.typeDevice ?? "").trim().toUpperCase();
  if (
    declarado === "CISCO" ||
    declarado === "HUAWEI" ||
    declarado === "ARUBA" ||
    declarado === "MIKROTIK" ||
    declarado === "JUNOS"
  ) {
    return PERFILES_VENDOR[declarado.toLowerCase() as VendorId];
  }

  const detectado = detectarVendorPorPrompt(input.prompt);
  return detectado ? PERFILES_VENDOR[detectado] : CONSERVADOR;
}

// ---------------------------------------------------------------------------
// Saneado de comandos
// ---------------------------------------------------------------------------

/**
 * Comandos que NUNCA se envían a una consola.
 *
 * POR QUÉ: cerrar la sesión (o salir al login) dejaría al usuario fuera de un
 * equipo al que quizá no puede volver a entrar, y es justo lo que hace un modelo
 * cuando "termina" una tarea. El servidor bloquea estos comandos por lotes
 * completos; aquí se descartan individualmente y se informa.
 */
const COMANDOS_DE_CIERRE = /^(exit|quit|logout|disconnect|close)$/i;

/** Extrae el prompt de la última línea con forma de prompt. */
export function detectarPrompt(salida: string, esPrompt: (l: string) => boolean): string | null {
  const lineas = String(salida ?? "").split(/\r?\n/);
  for (let i = lineas.length - 1; i >= 0; i--) {
    const linea = limpiar(lineas[i]);
    if (!linea) continue;
    return esPrompt(linea) ? linea : null;
  }
  return null;
}

/** Limpia la salida de consola: secuencias ANSI, retrocesos y CR sueltos. */
export function sanearSalida(texto: string): string {
  return String(texto ?? "")
    // Secuencias de escape ANSI (color, borrado de línea, movimiento de cursor).
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "") // OSC
    // `\b` de los borrados del eco de teclado.
    .replace(/[^\n]\x08/g, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Recorta la salida al máximo configurado, avisando de que se recortó. */
export function recortarSalida(texto: string): string {
  const maximo = envConfig.MCP_MAX_OUTPUT_CHARS;
  if (texto.length <= maximo) return texto;
  return `${texto.slice(0, maximo)}\n\n[...salida recortada: ${texto.length - maximo} caracteres omitidos. Usa un comando más específico para ver el resto.]`;
}

// ---------------------------------------------------------------------------
// Ciclo de ejecución
// ---------------------------------------------------------------------------

/**
 * Ejecuta uno o varios comandos en un transporte, con detección de fabricante.
 *
 * El orden es deliberado:
 *  1. Conectar (idempotente).
 *  2. Leer el estado inicial y resolver el fabricante (declarado o por prompt).
 *  3. Enviar el preámbulo del perfil (desactivar paginación), si lo declara.
 *  4. Enviar cada comando y leer su salida.
 *
 * El preámbulo importa: sin `terminal length 0`, un `show run` en Cisco se queda
 * esperando en `--More--` y la lectura expira; el agente lo interpretaría como
 * un equipo colgado.
 */
export async function ejecutarComandos(
  transporte: DeviceTransport,
  comandos: string[],
  contexto: { typeDevice?: string | null },
  opciones: OpcionesEjecucion = {},
): Promise<ResultadoComando> {
  const inicio = Date.now();
  const idleMs = opciones.idleMs ?? envConfig.MCP_TERMINAL_IDLE_MS;
  const maxMs = opciones.maxMs ?? envConfig.MCP_TERMINAL_MAX_MS;

  await transporte.connect();

  // --- 1) Resolver fabricante -------------------------------------------------
  const salidaInicial = await transporte.readOutput({ idleMs: 300, maxMs: 3000 });
  let perfil = opciones.vendorIdForzado
    ? PERFILES_VENDOR[opciones.vendorIdForzado as VendorId] ?? CONSERVADOR
    : resolverVendor({ typeDevice: contexto.typeDevice, prompt: salidaInicial });

  const promptInicial = detectarPrompt(salidaInicial, perfil.esPrompt);
  let vendorDetectadoEnEstaLlamada = !opciones.vendorIdForzado && Boolean(promptInicial);

  // Si el prompt no identificó al fabricante y no venía declarado, se reintenta
  // con una lectura más paciente: muchas consolas tardan en mostrar el prompt
  // (sobre todo tras un arranque en frío).
  if (!opciones.vendorIdForzado && perfil.id === "conservative" && !promptInicial) {
    const segundaLectura = await transporte.readOutput({ idleMs: 500, maxMs: 4000 });
    const promptTardio = detectarPrompt(segundaLectura, (l) => /[#>\]$]/.test(l));
    if (promptTardio) {
      perfil = resolverVendor({ typeDevice: contexto.typeDevice, prompt: promptTardio });
      vendorDetectadoEnEstaLlamada = perfil.id !== "conservative";
    }
  }

  Logger.debug(
    `Transporte ${transporte.protocol}: fabricante resuelto como '${perfil.id}' (${perfil.label}).`,
  );

  // --- 2) Preámbulo del perfil ------------------------------------------------
  const salidas: string[] = [];
  if (!opciones.sinPreambulo && perfil.preambulo.sinPaginacion) {
    try {
      await transporte.sendCommand(perfil.preambulo.sinPaginacion);
      await transporte.readOutput({ idleMs, maxMs: 5000 });
    } catch (error) {
      // El preámbulo es una mejora, no un requisito: si falla se sigue, pero se
      // deja constancia para que el modelo no interprete mal una salida paginada.
      Logger.debug(
        `El preámbulo '${perfil.preambulo.sinPaginacion}' falló: ${String(error)}`,
      );
    }
  }

  // --- 3) Comandos ------------------------------------------------------------
  const descartados: string[] = [];
  for (const crudo of comandos) {
    for (const linea of String(crudo).split(/\r?\n/)) {
      const comando = linea.trim();
      if (!comando) continue;

      if (COMANDOS_DE_CIERRE.test(comando)) {
        // Nunca se cierra la consola del usuario (ver COMANDOS_DE_CIERRE).
        descartados.push(comando);
        continue;
      }

      await transporte.sendCommand(comando);
      const salida = await transporte.readOutput({ idleMs, maxMs });
      salidas.push(`$ ${comando}\n${sanearSalida(salida)}`.trim());
    }
  }

  const salidaFinal = await transporte.readOutput({ idleMs: 200, maxMs: 2000 });
  const promptFinal =
    detectarPrompt(salidaFinal, perfil.esPrompt) ?? promptInicial;

  const avisos: string[] = [];
  if (descartados.length > 0) {
    avisos.push(
      `Se descartaron ${descartados.length} comando(s) de cierre de sesión (${descartados.join(", ")}): ` +
        `cerrar la consola dejaría fuera al usuario.`,
    );
  }

  const output = [
    salidas.join("\n\n"),
    avisos.length > 0 ? `\nAVISO: ${avisos.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join("");

  return {
    output: recortarSalida(output),
    prompt: promptFinal,
    vendorId: perfil.id,
    vendorLabel: perfil.label,
    vendorDetectado: vendorDetectadoEnEstaLlamada,
    duracionMs: Date.now() - inicio,
  };
}

/**
 * Mensaje de ayuda para el usuario cuando el fabricante salió conservador.
 * Es información, no un error: el equipo funciona, solo no se sabe qué es.
 */
export function notaVendorConservador(resultado: ResultadoComando): string {
  if (resultado.vendorId !== "conservative") return "";
  return (
    "\n\nNOTA: no se pudo identificar el fabricante del equipo por su prompt, así que se usó el perfil genérico. " +
    "Significa que se enviaron los comandos tal cual, SIN preámbulo (paginación) y SIN transiciones de modo. " +
    "Si conoces la marca, indícala en 'typeDevice' al configurar el dispositivo para que se use su sintaxis."
  );
}
