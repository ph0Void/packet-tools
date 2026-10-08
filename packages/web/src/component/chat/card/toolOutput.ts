export interface ResultadoWeb {
  titulo: string;
  url: string;
  descripcion: string;
}

export interface FuenteRag {
  titulo: string;
  score?: number;
  modo?: string;
}

const ESC = String.fromCharCode(27);

const ANSI_CSI_RE = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const ANSI_OSC_RE = new RegExp(
  `${ESC}\\][^\\u0007]*(?:\\u0007|${ESC}\\\\)`,
  "g",
);
const ANSI_SIMPLE_RE = new RegExp(`${ESC}[@-_]`, "g");

export function limpiarAnsi(texto: string): string {
  if (!texto) return "";
  return texto
    .replace(ANSI_CSI_RE, "")
    .replace(ANSI_OSC_RE, "")
    .replace(ANSI_SIMPLE_RE, "")
    .replace(/\r\n?/g, "\n");
}

export function parseWebResults(salida: string): ResultadoWeb[] {
  if (!salida) return [];
  const texto = limpiarAnsi(salida);
  const bloques = texto.split(/\n{2,}/);
  const resultados: ResultadoWeb[] = [];

  for (const bloque of bloques) {
    const lineas = bloque.split("\n").map((l) => l.trim());
    const cabecera = lineas.find((l) => /^\[\d+\]/.test(l));
    if (!cabecera) continue;
    const titulo = cabecera.replace(/^\[\d+\]\s*/, "").trim();
    if (!titulo) continue;

    const urlLinea = lineas.find((l) => /^URL:/i.test(l));
    const descripcionLinea = lineas.find((l) => /^Descripci[oó]n:/i.test(l));
    const url = urlLinea ? urlLinea.replace(/^URL:\s*/i, "").trim() : "";
    const descripcion = descripcionLinea
      ? descripcionLinea.slice(descripcionLinea.indexOf(":") + 1).trim()
      : "";

    resultados.push({ titulo, url, descripcion });
  }

  return resultados;
}

export function hostDe(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function rutaLegible(url: string): string {
  try {
    const u = new URL(url);
    const ruta = `${u.pathname}${u.search}`.replace(/\/$/, "");
    return ruta && ruta !== "" ? `${u.hostname.replace(/^www\./, "")}${ruta}` : u.hostname;
  } catch {
    return url;
  }
}

export function parseRagOutput(salida: string): {
  fuentes: FuenteRag[];
  documentos: string[];
  modo?: string;
} | null {
  if (!salida) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(salida);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const objeto = parsed as {
    documents?: unknown;
    metadatas?: unknown;
    sources?: unknown;
    mode?: unknown;
    message?: unknown;
  };

  if (!Array.isArray(objeto.documents) && !Array.isArray(objeto.sources)) {
    return null;
  }

  const metadatas = Array.isArray(objeto.metadatas) ? objeto.metadatas : [];
  const fuentes: FuenteRag[] = [];
  for (const m of metadatas) {
    if (!m || typeof m !== "object") continue;
    const meta = m as { title?: unknown; score?: unknown; mode?: unknown };
    if (typeof meta.title !== "string" || !meta.title) continue;
    const fuente: FuenteRag = { titulo: meta.title };
    if (typeof meta.score === "number") fuente.score = meta.score;
    if (typeof meta.mode === "string") fuente.modo = meta.mode;
    fuentes.push(fuente);
  }

  if (fuentes.length === 0 && Array.isArray(objeto.sources)) {
    for (const s of objeto.sources) {
      if (typeof s === "string" && s.trim()) {
        fuentes.push({ titulo: s.trim() });
      }
    }
  }

  const documentos = Array.isArray(objeto.documents)
    ? objeto.documents.filter((d): d is string => typeof d === "string")
    : [];

  return {
    fuentes: fuentes.length > 0 ? fuentes : [],
    documentos,
    modo: typeof objeto.mode === "string" ? objeto.mode : undefined,
  };
}

export const MAX_MOTIVO_CHARS = 220;

export function acotar(texto: string | null | undefined, max = MAX_MOTIVO_CHARS): string {
  if (typeof texto !== "string") return "";
  const limpio = texto.trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
}

export function fueAcotado(
  texto: string | null | undefined,
  max = MAX_MOTIVO_CHARS,
): boolean {
  return typeof texto === "string" && texto.trim().length > max;
}

export type MotivoSinPrompt =
  | "login_pendiente"
  | "arrancando"
  | "dialogo_pendiente"
  | "sin_salida"
  | "sesion_caida"
  | "desconocido";

const MOTIVO_SIN_PROMPT: Record<
  MotivoSinPrompt,
  { etiqueta: string; consejo: string }
> = {
  login_pendiente: {
    etiqueta: "Autenticación pendiente",
    consejo:
      "El equipo está pidiendo credenciales y el agente nunca las teclea: autentícate tú en la terminal y vuelve a intentarlo.",
  },
  arrancando: {
    etiqueta: "El equipo está arrancando",
    consejo:
      "El equipo todavía no ha terminado de arrancar: espera a que llegue a su prompt y reintenta.",
  },
  dialogo_pendiente: {
    etiqueta: "Diálogo abierto en la consola",
    consejo:
      "Hay una pregunta en pantalla ([y/n], confirmación…) que la respuesta es tuya: contéstala en la terminal y reintenta.",
  },
  sin_salida: {
    etiqueta: "El equipo no responde",
    consejo:
      "La consola no ha escrito nada: lo normal es que el equipo esté apagado. Enciéndelo y espera a que responda antes de reintentar.",
  },
  sesion_caida: {
    etiqueta: "La sesión se cerró",
    consejo:
      "La sesión de terminal se cerró por debajo: no hay consola contra la que trabajar. Vuelve a abrirla.",
  },
  desconocido: {
    etiqueta: "Motivo desconocido",
    consejo:
      "Hay texto en pantalla pero nada reconocible: mira la consola antes de reintentar.",
  },
};

export function esMotivoSinPrompt(valor: unknown): valor is MotivoSinPrompt {
  return (
    typeof valor === "string" && Object.prototype.hasOwnProperty.call(MOTIVO_SIN_PROMPT, valor)
  );
}

export function etiquetaSinPrompt(motivo: MotivoSinPrompt): string {
  return MOTIVO_SIN_PROMPT[motivo].etiqueta;
}

export function consejoSinPrompt(
  motivo: MotivoSinPrompt,
  consejoBackend?: string | null,
): string {
  const propio = consejoBackend?.trim();
  return propio && propio.length > 0 ? propio : MOTIVO_SIN_PROMPT[motivo].consejo;
}

export interface DiagnosticoSinPrompt {
  motivo: MotivoSinPrompt;
  etiqueta: string;
  consejo: string;

  pendiente: string | null;

  ultimaLinea: string | null;
}

export function parseSinPrompt(objeto: Record<string, unknown>): DiagnosticoSinPrompt | null {
  if (!esMotivoSinPrompt(objeto.motivoSinPrompt)) return null;
  const motivo = objeto.motivoSinPrompt;
  const bloque =
    objeto.sinPrompt && typeof objeto.sinPrompt === "object" && !Array.isArray(objeto.sinPrompt)
      ? (objeto.sinPrompt as Record<string, unknown>)
      : {};
  const texto = (valor: unknown): string | null =>
    typeof valor === "string" && valor.trim() ? limpiarAnsi(valor).trim() : null;
  return {
    motivo,
    etiqueta: etiquetaSinPrompt(motivo),
    consejo: consejoSinPrompt(motivo, texto(bloque.consejo) ?? texto(objeto.consejo)),
    pendiente: texto(bloque.pendiente) ?? texto(objeto.pendiente),
    ultimaLinea: texto(bloque.ultimaLinea) ?? texto(objeto.ultimaLinea),
  };
}

export interface LineaPlanConfig {
  fase: string;
  comando: string;
  motivo: string;
}

export interface OmitidaPlanConfig {
  fase: string;
  porque: string;
}

export type EstadoPaso = "enviado" | "omitido" | "dialogo" | "error" | "desconocido";

const ESTADO_PASO: Record<string, EstadoPaso> = {
  enviado: "enviado",
  omitido: "omitido",
  dialogo: "dialogo",
  error: "error",
};

export interface PasoConfig {
  fase: string;
  comando: string;
  estado: EstadoPaso;

  estadoCrudo: string;
  output: string;
  detail: string | null;
  paged: boolean;
  pages: number;
}

export interface DialogoConfig {
  texto: string;
  tipo: string;
  fase: string | null;

  respuesta: string;
  motivo: string | null;
}

export interface VerificacionConfig {
  pedidos: string[];
  resultados: { comando: string; output: string; endReason: string | null }[];

  completa: boolean;
  motivo: string | null;
}

export interface DespertarConsola {
  intentos: number;
  motivoFinal: string | null;
}

export interface CicloConfiguracion {

  codigo: string | null;
  deviceName: string | null;
  protocolo: string | null;
  vendorLabel: string | null;

  dryRun: boolean;

  escrito: boolean;
  plan: { lineas: LineaPlanConfig[]; omitidas: OmitidaPlanConfig[] };
  pasos: PasoConfig[];
  dialogos: DialogoConfig[];
  dialogoPendiente: DialogoConfig | null;
  motivoAborto: string | null;
  motivoAbortoTexto: string | null;
  verificacion: VerificacionConfig | null;
  modoFinal: string | null;
  modoIndeterminado: boolean;
  promptFinal: string | null;
  entramosEnConfig: boolean;
  guardado: boolean;

  salioDeConfig: boolean | null;
  avisoSalida: string | null;
  sinPrompt: DiagnosticoSinPrompt | null;
  despertar: DespertarConsola | null;
  mensaje: string | null;
  advertencia: string | null;
}

export const CODIGOS_CONFIGURACION = [
  "PLAN_ONLY",
  "DIALOGO_PENDIENTE",
  "NO_VERIFICADO",
  "CONFIG_ABORTED",
] as const;

const texto = (valor: unknown): string | null =>
  typeof valor === "string" && valor.trim() ? limpiarAnsi(valor) : null;

const listaTextos = (valor: unknown): string[] =>
  Array.isArray(valor)
    ? valor.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

function objetoDe(valor: unknown): Record<string, unknown> | null {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

function parseDialogo(valor: unknown): DialogoConfig | null {
  const o = objetoDe(valor);
  if (!o) return null;
  const contenido = texto(o.texto) ?? texto(o.textoDialogo);
  if (!contenido) return null;
  return {
    texto: contenido,
    tipo: texto(o.tipo)?.trim() ?? "desconocido",
    fase: texto(o.fase)?.trim() ?? null,
    respuesta: typeof o.respuesta === "string" ? o.respuesta : "",
    motivo: texto(o.motivo),
  };
}

function parsePasos(valor: unknown): PasoConfig[] {
  if (!Array.isArray(valor)) return [];
  const pasos: PasoConfig[] = [];
  for (const bruto of valor) {
    const o = objetoDe(bruto);
    if (!o) continue;
    const comando = texto(o.comando);
    if (!comando) continue;
    const estadoCrudo = (texto(o.estado)?.trim() ?? "").toLowerCase();
    pasos.push({
      fase: texto(o.fase)?.trim() ?? "comando",
      comando,
      estado: ESTADO_PASO[estadoCrudo] ?? "desconocido",
      estadoCrudo,
      output: texto(o.output) ?? "",
      detail: texto(o.detail) ?? texto(o.detalle),
      paged: o.paged === true,
      pages: typeof o.pages === "number" && o.pages > 0 ? o.pages : 0,
    });
  }
  return pasos;
}

function parseVerificacion(valor: unknown): VerificacionConfig | null {
  const o = objetoDe(valor);
  if (!o) return null;
  const pedidos = listaTextos(o.pedidos);
  const resultadosCrudos = Array.isArray(o.resultados) ? o.resultados : [];
  const resultados = resultadosCrudos.flatMap((bruto) => {
    const r = objetoDe(bruto);
    const comando = r ? texto(r.comando) : null;
    if (!r || !comando) return [];
    return [
      {
        comando,
        output: texto(r.output) ?? "",
        endReason: texto(r.endReason)?.trim() ?? null,
      },
    ];
  });
  if (pedidos.length === 0 && resultados.length === 0) return null;
  return {
    pedidos,
    resultados,
    completa: o.completa === true,
    motivo: texto(o.motivo),
  };
}

function parseDespertar(valor: unknown): DespertarConsola | null {
  const o = objetoDe(valor);
  if (!o) return null;
  const intentos = typeof o.intentos === "number" && o.intentos > 0 ? o.intentos : 0;
  if (intentos === 0 && !texto(o.motivoFinal)) return null;
  return { intentos, motivoFinal: texto(o.motivoFinal) };
}

export function parseCicloConfiguracion(salida: string): CicloConfiguracion | null {
  if (!salida) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(salida);
  } catch {
    return null;
  }
  const objeto = objetoDe(parsed);
  if (!objeto) return null;

  const planCrudo = objetoDe(objeto.plan);
  const pasosCrudos = Array.isArray(objeto.pasos) ? objeto.pasos : null;
  const codigo = texto(objeto.code)?.trim() ?? null;
  const esConfiguracion =
    (planCrudo !== null && Array.isArray(planCrudo.lineas)) ||
    pasosCrudos !== null ||
    typeof objeto.dryRun === "boolean" ||
    (codigo !== null && (CODIGOS_CONFIGURACION as readonly string[]).includes(codigo));
  if (!esConfiguracion) return null;

  const lineas: LineaPlanConfig[] = (
    Array.isArray(planCrudo?.lineas) ? (planCrudo!.lineas as unknown[]) : []
  ).flatMap((bruto) => {
    const l = objetoDe(bruto);
    const comando = l ? texto(l.comando) : null;
    if (!l || !comando) return [];
    return [
      {
        fase: texto(l.fase)?.trim() ?? "comando",
        comando,
        motivo: texto(l.motivo)?.trim() ?? "",
      },
    ];
  });

  const omitidas: OmitidaPlanConfig[] = (
    Array.isArray(planCrudo?.omitidas) ? (planCrudo!.omitidas as unknown[]) : []
  ).flatMap((bruto) => {
    const o = objetoDe(bruto);
    const porque = o ? texto(o.porque) ?? texto(o.motivo) : null;
    if (!o || !porque) return [];
    return [{ fase: texto(o.fase)?.trim() ?? "", porque }];
  });

  const dialogos = (Array.isArray(objeto.dialogos) ? objeto.dialogos : [])
    .flatMap((d) => {
      const parsedDialogo = parseDialogo(d);
      return parsedDialogo ? [parsedDialogo] : [];
    });

  return {
    codigo,
    deviceName: texto(objeto.deviceName)?.trim() ?? null,
    protocolo: texto(objeto.protocolo)?.trim() ?? null,
    vendorLabel: texto(objeto.vendorLabel)?.trim() ?? texto(objeto.vendor)?.trim() ?? null,
    dryRun: objeto.dryRun === true,
    escrito: objeto.escrito === true,
    plan: { lineas, omitidas },
    pasos: parsePasos(objeto.pasos),
    dialogos,
    dialogoPendiente: parseDialogo(objeto.dialogoPendiente),
    motivoAborto: texto(objeto.motivoAborto)?.trim() ?? null,
    motivoAbortoTexto: texto(objeto.motivoAbortoTexto) ?? texto(objeto.avisoSalida),
    verificacion: parseVerificacion(objeto.verificacion),
    modoFinal: texto(objeto.modoFinal)?.trim() ?? null,
    modoIndeterminado: objeto.modoIndeterminado === true,
    promptFinal: texto(objeto.promptFinal)?.trim() ?? null,
    entramosEnConfig: objeto.entramosEnConfig === true,
    guardado: objeto.guardado === true,
    salioDeConfig: typeof objeto.salioDeConfig === "boolean" ? objeto.salioDeConfig : null,
    avisoSalida: texto(objeto.avisoSalida),
    sinPrompt: parseSinPrompt(objeto),
    despertar: parseDespertar(objeto.despertar),
    mensaje: texto(objeto.message),
    advertencia: texto(objeto.warning),
  };
}

export type SituacionConfiguracion =
  | "plan"
  | "dialogo_pendiente"
  | "aplicada_sin_verificar"
  | "aplicada_verificada"
  | "aplicada"
  | "abortada"
  | "sin_escribir";

export type TonoSituacion = "ok" | "aviso" | "error" | "info" | "neutro";

export interface ResumenSituacion {
  situacion: SituacionConfiguracion;
  titulo: string;

  explicacion: string;
  tono: TonoSituacion;
}

export function situacionConfiguracion(ciclo: CicloConfiguracion): ResumenSituacion {
  if (ciclo.dryRun) {
    return {
      situacion: "plan",
      titulo: "Simulación: no se escribió nada",
      explicacion:
        "Esto es el plan que se aplicaría al equipo. No se ha enviado ni un solo comando: nada de lo que hay aquí está en el dispositivo todavía.",
      tono: "info",
    };
  }
  if (ciclo.dialogoPendiente || ciclo.codigo === "DIALOGO_PENDIENTE") {
    return {
      situacion: "dialogo_pendiente",
      titulo: "La consola tiene un diálogo sin contestar",
      explicacion:
        "El motor se paró porque el equipo hizo una pregunta que no era suya. Contéstala en la terminal y vuelve a intentarlo.",
      tono: "aviso",
    };
  }
  if (ciclo.codigo === "NO_VERIFICADO" || ciclo.verificacion?.completa === false) {
    return {
      situacion: "aplicada_sin_verificar",
      titulo: "Se aplicó, pero no se ha podido verificar",
      explicacion:
        "Los comandos se escribieron, pero no se ha podido leer el equipo para confirmarlos. No se da por aplicado lo que no se ha leído.",
      tono: "aviso",
    };
  }
  if (ciclo.codigo === "CONFIG_ABORTED" || ciclo.motivoAborto !== null) {
    return {
      situacion: "abortada",
      titulo: "La configuración se paró",
      explicacion:
        "El lote no llegó a terminarse. Lo que sí se escribió está en los pasos de abajo, paso a paso.",
      tono: "error",
    };
  }
  if (ciclo.verificacion?.completa === true) {
    return {
      situacion: "aplicada_verificada",
      titulo: "Configuración aplicada y verificada",
      explicacion:
        "Los comandos se escribieron y se han releído del equipo: la configuración está confirmada.",
      tono: "ok",
    };
  }
  if (ciclo.escrito) {
    return {
      situacion: "aplicada",
      titulo: "Configuración aplicada, sin verificación por lectura",
      explicacion:
        "Los comandos se escribieron, pero el agente no pidió releer el equipo: el resultado no está confirmado por lectura.",
      tono: "ok",
    };
  }
  return {
    situacion: "sin_escribir",
    titulo: "No se escribió nada en el equipo",
    explicacion: "El lote se paró antes de enviar el primer comando.",
    tono: "neutro",
  };
}

export function quedoEnSubModo(ciclo: CicloConfiguracion): boolean {
  if (ciclo.dryRun) return false;
  if (ciclo.salioDeConfig === false) return true;
  if (ciclo.motivoAborto === "no_se_sale_de_config") return true;
  return ciclo.entramosEnConfig && ciclo.modoFinal === "config";
}

export const ETIQUETA_FASE_PLAN: Record<string, string> = {
  despertar: "Despertar consola",
  paginador: "Desactivar paginador",
  privilegio: "Modo privilegiado",
  config: "Modo configuración",
  comando: "Comando",
  guardar: "Guardar configuración",
  salida: "Salir de configuración",
  verificacion: "Verificación",
};

export function etiquetaFasePlan(fase: string): string {
  return ETIQUETA_FASE_PLAN[fase] ?? fase;
}

export const ETIQUETA_ESTADO_PASO: Record<EstadoPaso, string> = {
  enviado: "Enviado",
  omitido: "Omitido",
  dialogo: "Diálogo",
  error: "Error",
  desconocido: "Estado desconocido",
};

export const ETIQUETA_MOTIVO_ABORTO: Record<string, string> = {
  pregunta_al_usuario: "El equipo hizo una pregunta y la respuesta es tuya",
  confirmacion_destructiva: "Confirmación destructiva: el motor no contesta",
  paginador_sin_respuesta: "El paginador dejó de responder",
  dialogo_desconocido: "Diálogo no reconocido: no se contesta a ciegas",
  equipo_no_responde: "El equipo no volvió al prompt",
  salida_no_soportada: "Este equipo no admite el comando de salida",
  no_se_sale_de_config: "No se pudo salir del modo configuración",
  sesion_caida: "La sesión de terminal se cerró",
};

export function etiquetaMotivoAborto(motivo: string | null): string | null {
  if (!motivo) return null;
  return ETIQUETA_MOTIVO_ABORTO[motivo] ?? motivo;
}

export const ETIQUETA_MOTIVO_CORTE: Record<string, string> = {
  sin_eco: "No había eco del comando en la salida",
  sin_comando: "No se pudo saber qué comando se envían",
  eco_sin_salida: "Lo que parecía eco no tenía salida de verdad detrás",
  eco_solo_prompt: "Detrás del eco solo estaba el prompt",
};

export function etiquetaMotivoCorte(motivo: string): string {
  return ETIQUETA_MOTIVO_CORTE[motivo] ?? motivo;
}

export interface DiagnosticoConsola {
  codigo: string | null;
  mensaje: string | null;
  sinPrompt: DiagnosticoSinPrompt | null;
  paged: boolean;
  pages: number;
  pagerVariant: string | null;

  recortado: boolean;

  motivoCorte: string | null;
  despertar: DespertarConsola | null;

  timedOut: boolean | null;
  endReason: string | null;

  texto: string | null;
}

const CODIGOS_DIAGNOSTICO = [
  "NO_OUTPUT",
  "NO_COMMANDS_EXECUTED",
  "TERMINAL_NOT_RESPONDING",
] as const;

const MAX_TEXTO_CONSOLA = 4_000;

function textoConsolaDe(objeto: Record<string, unknown>): string | null {
  const salida = texto(objeto.output);
  if (salida && salida.trim()) {
    return salida.length > MAX_TEXTO_CONSOLA
      ? `${salida.slice(0, MAX_TEXTO_CONSOLA)}\n… [recortado]`
      : salida;
  }
  const lineas = (Array.isArray(objeto.lines) ? objeto.lines : [])
    .filter((l): l is string => typeof l === "string");
  if (lineas.length === 0) return null;
  const unido = lineas.join("\n");
  return unido.length > MAX_TEXTO_CONSOLA
    ? `${unido.slice(0, MAX_TEXTO_CONSOLA)}\n… [recortado]`
    : unido;
}

export function parseDiagnosticoConsola(salida: string): DiagnosticoConsola | null {
  if (!salida) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(salida);
  } catch {
    return null;
  }
  const objeto = objetoDe(parsed);
  if (!objeto) return null;

  const codigo = texto(objeto.code)?.trim() ?? null;
  const sinPrompt = parseSinPrompt(objeto);
  const paged = objeto.paged === true;
  const pages = typeof objeto.pages === "number" && objeto.pages > 0 ? objeto.pages : 0;
  const recortado = objeto.recortado === true;
  const motivoCorte = texto(objeto.motivoCorte);
  const despertar = parseDespertar(objeto.despertar);
  const timedOut = typeof objeto.timedOut === "boolean" ? objeto.timedOut : null;

  const codigoConocido =
    codigo !== null && (CODIGOS_DIAGNOSTICO as readonly string[]).includes(codigo);
  const hayAlgo =
    sinPrompt !== null ||
    codigoConocido ||
    paged ||
    recortado ||
    motivoCorte !== null ||
    despertar !== null ||
    timedOut === true;
  if (!hayAlgo) return null;

  return {
    codigo,
    mensaje: texto(objeto.message),
    sinPrompt,
    paged,
    pages,
    pagerVariant: texto(objeto.pagerVariant)?.trim() ?? null,
    recortado,
    motivoCorte,
    despertar,
    timedOut,
    endReason: texto(objeto.endReason)?.trim() ?? null,
    texto: textoConsolaDe(objeto),
  };
}

export interface DispositivoResumen {
  id: string;
  name: string;
  protocol: string | null;
  status: string | null;
  host: string | null;
  serialPort: string | null;
}

export function parseDispositivos(salida: string): DispositivoResumen[] | null {
  if (!salida) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(salida);
  } catch {
    return null;
  }
  const crudos = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object" && Array.isArray((parsed as { providers?: unknown }).providers)
      ? ((parsed as { providers: unknown[] }).providers)
      : null;
  if (!crudos) return null;

  const pareceProveedor = (p: unknown) =>
    p !== null &&
    typeof p === "object" &&
    ("protocol" in p || "serialPort" in p);
  if (!crudos.some(pareceProveedor)) return null;

  const dispositivos: DispositivoResumen[] = [];
  crudos.forEach((raw, idx) => {
    if (!raw || typeof raw !== "object") return;
    const r = raw as Record<string, unknown>;
    const name =
      typeof r.name === "string"
        ? r.name
        : typeof r.deviceName === "string"
          ? r.deviceName
          : null;
    if (!name) return;
    dispositivos.push({
      id: typeof r.id === "string" ? r.id : `dev-${idx}`,
      name,
      protocol: typeof r.protocol === "string" ? r.protocol : null,
      status: typeof r.status === "string" ? r.status : null,
      host: typeof r.host === "string" ? r.host : null,
      serialPort: typeof r.serialPort === "string" ? r.serialPort : null,
    });
  });
  return dispositivos.length > 0 ? dispositivos : null;
}

export const ETIQUETA_TOOL: Record<string, string> = {

  sendSerialCommand: "Envío por consola serial",
  executeSshCommands: "Comandos por SSH",
  executeTelnetCommands: "Comandos por Telnet",
  send_command: "Envío de comando",
  read_terminal: "Lectura de la consola",
  wait_for_prompt: "Espera del prompt",
  get_terminal_status: "Estado de la consola",
  configure_device: "Configuración del equipo",
  configureIosDevice: "Configuración IOS",
  configurePcIp: "Configuración IP del PC",
  runDeviceCommand: "Comandos de solo lectura",
  readDeviceConsole: "Consola del dispositivo",
  open_terminal_console: "Apertura de consola",
  openGns3Console: "Apertura de consola GNS3",

  getNetwork: "Topología de red",
  getDeviceInfo: "Información del dispositivo",
  findDeviceByName: "Búsqueda de equipo",
  listDeviceProviders: "Dispositivos disponibles",
  createDeviceProvider: "Alta de dispositivo",
  updateDeviceProvider: "Edición de dispositivo",
  deleteDeviceProvider: "Baja de dispositivo",
  testDeviceProviderConnection: "Prueba de conexión",
  getSimulationStatus: "Estado de la simulación",
  getPduResults: "Resultados de PDU",
  getCommandLog: "Registro de comandos",
  addDevice: "Añadir dispositivo",
  addModule: "Añadir módulo",
  addLink: "Añadir enlace",
  removeDevice: "Eliminar dispositivo",
  removeLink: "Eliminar enlace",
  createTopology: "Crear topología",
  renameDevice: "Renombrar dispositivo",
  moveDevice: "Mover dispositivo",
  setPower: "Cambiar energía",
  setSimulationMode: "Modo de simulación",
  stepSimulation: "Avanzar simulación",
  sendPdu: "Enviar PDU",
  validateTopology: "Validar topología",
  listDeviceModels: "Modelos disponibles",
  listDeviceModules: "Módulos del dispositivo",
  clearWorkspace: "Vaciar workspace",
  exportTopologyFile: "Exportar .pkt",
  importTopologyFile: "Importar .pkt",

  getDeviceConfig: "Configuración actual",
  getRoutingTable: "Tabla de rutas",
  getVlanConfiguration: "Configuración de VLANs",
  getDeviceMetrics: "Métricas del dispositivo",
  saveDeviceConfig: "Guardar snapshot",
  restoreDeviceConfig: "Restaurar snapshot",
  generateNetworkReport: "Informe de red",
  qaTopologySuite: "Auditoría de topología",
  subnetCalc: "Cálculo de subredes",
  pingTopology: "Ping de extremo a extremo",
  reachMatrix: "Matriz de alcance",
  validateSecurityConfig: "Validación de seguridad",
  simulateLinkFailure: "Simular caída de enlace",
  restoreLink: "Restaurar enlace",

  createGns3Project: "Crear proyecto GNS3",
  createGns3Node: "Crear nodo GNS3",
  connectGns3Nodes: "Conectar nodos GNS3",
  controlGns3NodePower: "Energía de nodo GNS3",
  listGns3Nodes: "Nodos de GNS3",
  listGns3Links: "Enlaces de GNS3",
  getGns3Templates: "Plantillas de GNS3",

  search_knowledge_base: "Consulta en base de conocimiento",
  search_web_tool: "Búsqueda web",
  fetch_web_page_tool: "Lectura de página web",

  listSkills: "Listado de skills",
  createSkill: "Creación de skill",
  updateSkill: "Edición de skill",
  deleteSkill: "Baja de skill",
  createKnowledgeDocument: "Alta de documento",
  ingest_document_to_chroma: "Indexación de documento",

  listCronJobs: "Listado de tareas programadas",
  createCronJob: "Alta de tarea programada",
  updateCronJob: "Edición de tarea programada",
  toggleCronJob: "Activación de tarea programada",
  deleteCronJob: "Baja de tarea programada",
  updateGlobalSystemPrompt: "Prompt global del sistema",
  getSystemMetrics: "Métricas del sistema",

  write_todos: "Plan del turno",
  read_file: "Lectura de archivo",
  write_file: "Escritura de archivo",
  edit_file: "Edición de archivo",
  ls: "Listado de archivos",
  glob: "Búsqueda por patrón",
  grep: "Búsqueda en archivos",
  task: "Delegación a sub-agente",
};

function humanizarNombre(name: string): string {
  const texto = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-záéíóúñ0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!texto) return "Herramienta";
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function etiquetaHerramienta(name: string): string {
  if (!name) return "Herramienta";
  return ETIQUETA_TOOL[name] ?? humanizarNombre(name);
}

export interface CaducidadAprobacion {

  texto: string;

  expirada: boolean;

  restanteMs: number;
}

export function instanteDeCaducidad(
  valor: string | number | null | undefined,
): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  if (!limpio) return null;
  const ms = Date.parse(limpio);
  return Number.isNaN(ms) ? null : ms;
}

export function textoCaducidad(
  expiresAt: string | number | null | undefined,
  ahora: number = Date.now(),
): CaducidadAprobacion | null {
  const expira = instanteDeCaducidad(expiresAt);
  if (expira === null) return null;
  const restanteMs = expira - ahora;
  if (restanteMs <= 0) {
    return { texto: "expirada", expirada: true, restanteMs: 0 };
  }
  if (restanteMs < 60_000) {
    const segundos = Math.ceil(restanteMs / 1000);
    return { texto: `caduca en ${segundos} s`, expirada: false, restanteMs };
  }
  const minutos = Math.ceil(restanteMs / 60_000);
  return { texto: `caduca en ${minutos} min`, expirada: false, restanteMs };
}

export function proximoCambioCaducidad(
  expiresAt: string | number | null | undefined,
  ahora: number = Date.now(),
): number {
  const expira = instanteDeCaducidad(expiresAt);
  if (expira === null) return Number.POSITIVE_INFINITY;
  const restante = expira - ahora;
  if (restante <= 0) return Number.POSITIVE_INFINITY;

  const paso = restante < 60_000 ? 1000 : 60_000;
  const dentro = restante % paso;
  return dentro > 0 ? dentro + 1 : 1;
}

const MARCADORES_APROBACION: Record<string, { que: string; accion: string }> = {
  "[APROBACION_RECHAZADA]": {
    que: "Cancelaste la configuración, así que no se aplicó ningún cambio.",
    accion: "Pídele al agente que la repita si sigue haciendo falta.",
  },
  "[APROBACION_EXPIRADA]": {
    que: "La solicitud caducó antes de que respondieras.",
    accion: "Pídele al agente que la repita.",
  },
  "[APROBACION_CANCELADA]": {
    que: "El turno terminó sin respuesta a la solicitud de aprobación.",
    accion: "Pídele al agente que la repita.",
  },
  "[TURNO_INTERRUMPIDO]": {
    que: "El turno terminó antes de que la herramienta informara del resultado.",
    accion: "Comprueba en el equipo qué quedó aplicado antes de continuar.",
  },
  "[BLOQUEADO_ROL]": {
    que: "Tu rol no puede ejecutar cambios de configuración.",
    accion: "Hazlo con una cuenta STAFF o ADMIN.",
  },
  "[SESION_PROTEGIDA]": {
    que: "La consola está protegida: no se enviaron comandos de cierre de sesión.",
    accion: "",
  },
};

const CLAVES_CONEXION = [
  "error enviando comando",
  "no se pudo conectar",
  "terminal no conectada",
  "access denied",
  "cannot open",
  "port is busy",
  "resource busy",
  "econnrefused",
  "connection refused",
  "connection reset",
  "connection closed",
  "ehostunreach",
  "enetunreach",
  "etimedout",
  "epipe",
  "timed out",
  "timeout",
];

export interface ErrorAmigable {

  que: string;

  accion: string;

  reintentable: boolean;
}

export function resumirError(salida: string | undefined): ErrorAmigable {
  const limpia = limpiarAnsi(salida ?? "");
  const lower = limpia.toLowerCase();

  const entrada = Object.entries(MARCADORES_APROBACION).find(([marcador]) =>
    limpia.includes(marcador),
  );
  if (entrada) {
    return { que: entrada[1].que, accion: entrada[1].accion, reintentable: false };
  }

  if (
    lower.includes("aprobaci") ||
    lower.includes("bloqueado_rol") ||
    lower.includes("aprobacion")
  ) {
    return {
      que: "La acción necesitaba tu autorización y no llegó a ejecutarse.",
      accion: "Revísala en la tarjeta de aprobación y responde para continuar.",
      reintentable: false,
    };
  }

  if (CLAVES_CONEXION.some((clave) => lower.includes(clave.toLowerCase()))) {
    return {
      que: "No hubo comunicación con el equipo: falló la conexión o el puerto.",
      accion: "Comprueba que el equipo responda y reconecta la terminal.",
      reintentable: true,
    };
  }

  return {
    que: "La herramienta no pudo completar la operación.",
    accion: "El detalle está en «Detalles técnicos»; prueba con otra operación.",
    reintentable: false,
  };
}

export function explicacionCancelacion(salida: string | undefined): string {
  const limpia = limpiarAnsi(salida ?? "");
  const entrada = Object.entries(MARCADORES_APROBACION).find(([marcador]) =>
    limpia.includes(marcador),
  );
  return entrada
    ? entrada[1].que
    : "La acción se canceló y no llegó a ejecutarse.";
}
