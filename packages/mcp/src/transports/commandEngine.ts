
import type { DeviceTransport, OpcionesEjecucion, ResultadoComando } from "./DeviceTransport";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";






export type VendorId = "cisco" | "huawei" | "mikrotik" | "aruba" | "junos" | "conservative";


interface PerfilVendor {
  id: VendorId;
  label: string;
  
  esSubModo: (linea: string) => boolean;
  
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


const PROMPT_MAX_CHARS = 120;


function limpiar(linea?: string | null): string {
  return String(linea ?? "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r/g, "")
    .trim();
}


function parecePrompt(linea: string): boolean {
  const texto = limpiar(linea);
  return texto.length > 0 && texto.length <= PROMPT_MAX_CHARS;
}


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
    
    salirDeConfig: "exit",
  },
  preambulo: { sinPaginacion: "terminal length 0" },
  paginador: [/--More--/, /\(END\)/],
};


const HUAWEI_VISTA = /^\[[^\]]*\]\s*$/;
const HUAWEI: PerfilVendor = {
  id: "huawei",
  label: "Huawei VRP",
  
  esSubModo: (linea) => /^\[[^\]]*[-/][^\]]*\]\s*$/.test(limpiar(linea)),
  esPrompt: (linea) => {
    const texto = limpiar(linea);
    if (!parecePrompt(texto)) return false;
    return HUAWEI_VISTA.test(texto) || /^<[^<>]+>\s*$/.test(texto);
  },
  transiciones: {
    aUsuario: "quit",
    
    aPrivilegiado: null,
    aConfig: "system-view",
    guardarConfig: "save",
    salirDeConfig: "quit",
  },
  preambulo: { sinPaginacion: "screen-length 0 temporary" },
  paginador: [/----\s*More\s*----/, /\(END\)/],
};


const MIKROTIK_RAIZ = /^\[[^\]]*@[^\]]*\]\s*[>\/]?\s*$/;
const MIKROTIK_MENU = /^\[[^\]]*@[^\]]*\]\s*\/\S+/;

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
    
    
    aConfig: null,
    guardarConfig: null,
    
    salirDeConfig: "..",
  },
  preambulo: { sinPaginacion: null },
  paginador: [/\[Q\s*\|\s*quit\]/, /\(END\)/],
};


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
    guardarConfig: null, 
    salirDeConfig: "exit",
  },
  preambulo: { sinPaginacion: null },
  paginador: [/--More--/, /\(END\)/],
};


const JUNOS_PROMPT = /^\S+@\S+[>#]\s*$/;

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
    
    
    aUsuario: null,
    aPrivilegiado: null,
    aConfig: null,
    guardarConfig: null,
    salirDeConfig: null,
  },
  preambulo: { sinPaginacion: null },
  paginador: [/--More--/, /----\s*More\s*----/, /\(END\)/],
};


export const PERFILES_VENDOR: Record<VendorId, PerfilVendor> = {
  cisco: CISCO,
  huawei: HUAWEI,
  mikrotik: MIKROTIK,
  aruba: ARUBA,
  junos: JUNOS,
  conservative: CONSERVADOR,
};


export function detectarVendorPorPrompt(prompt?: string | null): VendorId | null {
  const texto = limpiar(prompt);
  if (!parecePrompt(texto)) return null;

  if (MIKROTIK_RAIZ.test(texto) || MIKROTIK_MENU.test(texto)) return "mikrotik";
  if (JUNOS_SUBMODO.test(texto) || JUNOS_HOST_PROMPT.test(texto)) return "junos";
  if (HUAWEI_VISTA.test(texto) || /^<[^<>]+>\s*$/.test(texto)) return "huawei";
  if (ARUBA_PROMPT.test(texto)) return "aruba";
  if (/\(config[^)]*\)#\s*$/.test(texto)) return "cisco";

  
  return null;
}


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






const COMANDOS_DE_CIERRE = /^(exit|quit|logout|disconnect|close)$/i;


export function detectarPrompt(salida: string, esPrompt: (l: string) => boolean): string | null {
  const lineas = String(salida ?? "").split(/\r?\n/);
  for (let i = lineas.length - 1; i >= 0; i--) {
    const linea = limpiar(lineas[i]);
    if (!linea) continue;
    return esPrompt(linea) ? linea : null;
  }
  return null;
}


export function sanearSalida(texto: string): string {
  return String(texto ?? "")
    
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "") 
    
    .replace(/[^\n]\x08/g, "")
    .replace(/\r(?!\n)/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


export function recortarSalida(texto: string): string {
  const maximo = envConfig.MCP_MAX_OUTPUT_CHARS;
  if (texto.length <= maximo) return texto;
  return `${texto.slice(0, maximo)}\n\n[...salida recortada: ${texto.length - maximo} caracteres omitidos. Usa un comando más específico para ver el resto.]`;
}






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

  
  const salidaInicial = await transporte.readOutput({ idleMs: 300, maxMs: 3000 });
  let perfil = opciones.vendorIdForzado
    ? PERFILES_VENDOR[opciones.vendorIdForzado as VendorId] ?? CONSERVADOR
    : resolverVendor({ typeDevice: contexto.typeDevice, prompt: salidaInicial });

  const promptInicial = detectarPrompt(salidaInicial, perfil.esPrompt);
  let vendorDetectadoEnEstaLlamada = !opciones.vendorIdForzado && Boolean(promptInicial);

  
  
  
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

  
  const salidas: string[] = [];
  if (!opciones.sinPreambulo && perfil.preambulo.sinPaginacion) {
    try {
      await transporte.sendCommand(perfil.preambulo.sinPaginacion);
      await transporte.readOutput({ idleMs, maxMs: 5000 });
    } catch (error) {
      
      
      Logger.debug(
        `El preámbulo '${perfil.preambulo.sinPaginacion}' falló: ${String(error)}`,
      );
    }
  }

  
  const descartados: string[] = [];
  for (const crudo of comandos) {
    for (const linea of String(crudo).split(/\r?\n/)) {
      const comando = linea.trim();
      if (!comando) continue;

      if (COMANDOS_DE_CIERRE.test(comando)) {
        
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


export function notaVendorConservador(resultado: ResultadoComando): string {
  if (resultado.vendorId !== "conservative") return "";
  return (
    "\n\nNOTA: no se pudo identificar el fabricante del equipo por su prompt, así que se usó el perfil genérico. " +
    "Significa que se enviaron los comandos tal cual, SIN preámbulo (paginación) y SIN transiciones de modo. " +
    "Si conoces la marca, indícala en 'typeDevice' al configurar el dispositivo para que se use su sintaxis."
  );
}
