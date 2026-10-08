import type { DeepConnection } from "./context";

export type FastPathSpecialist = "ssh" | "telnet" | "serial";

export interface FastPathInput {

  enabled: boolean;

  origin: string;

  role: string;

  connection: DeepConnection | null | undefined;

  textoUsuario: string;

  ragPrefetched?: boolean;

  webRequired?: boolean;

  skillRequested?: string | null;

  mentionedProviderId?: string | null;
}

export interface FastPathDecision {

  ir: boolean;

  especialista: FastPathSpecialist | null;

  motivo: string;
}

export const MARCADOR_COLA_TERMINAL = "--- Última salida de terminal ---";

export function textoSinColaDeTerminal(texto: string): string {
  const original = String(texto ?? "");
  const corte = original.indexOf(MARCADOR_COLA_TERMINAL);
  if (corte < 0) return original;
  return original.slice(0, corte).trimEnd();
}

const VERBOS_DE_EJECUCION = [
  "muestra", "muestrame", "muéstrame", "enseñame", "ensename", "dime", "diga",
  "ejecuta", "ejecutar", "corre", "corra", "lanza", "prueba", "probar", "ping",
  "lee", "leer", "leeme", "consulta", "consultar", "revisa", "revisar", "mirar",
  "comprueba", "comprobar", "verifica", "verificar", "chequea", "status",
  "configura", "configurar", "aplica", "aplicar", "cambia", "cambiar", "pon",
  "poner", "asigna", "asignar", "establece", "establecer", "anade", "añade",
  "agrega", "crea", "crear", "borra", "borrar", "elimina", "eliminar", "quita",
  "guarda", "guardar", "reinicia", "reiniciar", "apaga", "encciende", "arranca",
  "para", "sube", "baja", "migrate", "copia", "abre", "cierra", "exporta",
  "muestra el", "captura", "describe", "revisemos", "probemos",

  "quiero saber", "saber", "cual es el modelo", "cual es la version",
  "cual es", "que modelo", "que version", "dime cual",
];

const MARCAS_TEORICAS = [
  "explícame", "expliqueme", "explicame", "explícame", "explícame qué",
  "explica", "qué es", "que es", "que significa", "significa", "diferencia entre",
  "diferencias entre", "compara", "comparar", "comparativa", "para qué sirve",
  "para que sirve", "cómo funciona", "como funciona", "concepto", "definición",
  "definicion", "ventajas", "desventajas", "recomienda", "recomendación",
  "recomendacion", "best practice", "buenas prácticas", "documentación",
  "documentacion", "manual del fabricante", "tutorial", "por qué", "porque ",
  "ayúdame a entender", "ayudame a entender", "cuál es la mejor", "cual es la mejor",
  "historia de", "evolución de", "evolucion de",
];

const MARCAS_DE_OTRO_SISTEMA = [
  "gns3", "packet tracer", "pack-tracer", "cron", "cronjob", "tarea programada",
  "tareas programadas", "skill", "base de conocimiento", "documento", "documentos",
  "internet", "web", "buscar en google", "documentacion del fabricante",
];

const MAX_CHARS = 400;

function normaliza(texto: string): string {
  return ` ${String(texto ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function contieneAlguno(textoNormalizado: string, terminos: readonly string[]): string | null {
  for (const termino of terminos) {
    const patron = new RegExp(
      `(^|[^a-z0-9])${termino.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
    );
    if (patron.test(textoNormalizado)) return termino;
  }
  return null;
}

export function especialistaPorProtocolo(
  protocol: string | null | undefined,
): FastPathSpecialist | null {
  const proto = String(protocol ?? "").trim().toUpperCase();
  if (proto === "SSH") return "ssh";
  if (proto === "TELNET") return "telnet";
  if (proto === "SERIAL") return "serial";
  return null;
}

function cuentaObjetivos(texto: string): number {
  const candidatos = texto
    .split(/[,;]|\sy\b|\so\b/i)
    .map((trozo) => trozo.trim())
    .filter((trozo) => /\b(r\d+|sw\d+|rtr\d+|router\d+|switch\d+|core\d+|edge\d+)\b/i.test(trozo));
  return new Set(candidatos.map((c) => c.toLowerCase())).size;
}

export function decidirFastPath(entrada: FastPathInput): FastPathDecision {
  const no = (motivo: string): FastPathDecision => ({
    ir: false,
    especialista: null,
    motivo,
  });

  if (!entrada.enabled) return no("flag FAST_PATH_ENABLED apagado");
  if (entrada.origin !== "terminal") return no("el turno no viene de la consola");

  const conexion = entrada.connection;
  if (!conexion) return no("no hay conexión objetivo");
  if (!conexion.alive) return no("la consola del dispositivo no está viva");

  const especialista = especialistaPorProtocolo(conexion.protocol);
  if (!especialista) {
    return no(
      `el protocolo ${conexion.protocol ?? "(desconocido)"} no es un especialista de terminal`,
    );
  }

  if (entrada.skillRequested) return no("hay una @skill que el supervisor debe leer");
  if (entrada.webRequired) return no("la mención @web obliga al supervisor a buscar");

  const texto = textoSinColaDeTerminal(entrada.textoUsuario ?? "").trim();
  if (!texto) return no("no hay texto del usuario");
  if (texto.length > MAX_CHARS) return no("el turno es demasiado largo para un solo paso");

  const normalizado = normaliza(texto);

  const otro = contieneAlguno(normalizado, MARCAS_DE_OTRO_SISTEMA);
  if (otro) return no(`el turno menciona otro sistema ("${otro}")`);

  const teorica = contieneAlguno(normalizado, MARCAS_TEORICAS);
  if (teorica) return no(`el turno es una petición teórica ("${teorica}")`);

  const ejecucion = contieneAlguno(normalizado, VERBOS_DE_EJECUCION);
  if (!ejecucion) return no("no hay intención de ejecución o lectura");

  if (cuentaObjetivos(texto) > 1) return no("el turno menciona más de un dispositivo");

  return {
    ir: true,
    especialista,
    motivo: `terminal + consola viva (${especialista}) + intención de ejecución ("${ejecucion}")`,
  };
}

export const FAST_PATH_FALLBACK = "[FAST_PATH_FALLBACK]";

export const FAST_PATH_RULE = [
  "Fast path: this turn comes straight from the device console, without a supervisor in between. Operate ONLY on the console described above and answer the user's request about it.",
  `If the request is NOT about this console (theory, another system, or work that needs a different specialist), reply with exactly '${FAST_PATH_FALLBACK} ' followed by one short line saying why, and call no tool: the request is handed back to the supervisor.`,
  "The HITL and the role gates are identical here: mutating actions still need the user's approval.",
].join("\n");

export const FAST_PATH_REGLAS = {

  marcador: FAST_PATH_FALLBACK,

  sinToolCalls: "no resolvio",
} as const;
