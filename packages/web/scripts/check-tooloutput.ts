import {
  acotar,
  fueAcotado,
  explicacionCancelacion,
  etiquetaHerramienta,
  ETIQUETA_TOOL,
  parseCicloConfiguracion,
  parseDiagnosticoConsola,
  parseDispositivos,
  parseRagOutput,
  parseWebResults,
  proximoCambioCaducidad,
  quedoEnSubModo,
  resumirError,
  situacionConfiguracion,
  textoCaducidad,
} from "../src/component/chat/card/toolOutput";

let failures = 0;
let total = 0;

function check(name: string, condition: boolean, detail?: string): void {
  total += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` → ${detail}` : ""}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

const json = (value: unknown): string => JSON.stringify(value);

const PLAN_ONLY = {
  success: true,
  sessionId: "ses-1",
  deviceName: "core-r1",
  protocol: "ssh",
  vendor: "mikrotik",
  vendorLabel: "MikroTik RouterOS",
  dryRun: true,
  escrito: false,
  plan: {
    lineas: [
      { fase: "paginador", comando: "/set cli-mode=no", motivo: "Perfil del equipo" },
      { fase: "config", comando: "/ip address add address=10.0.0.1/24", motivo: "Comando del agente" },
      { fase: "salida", comando: "/exit", motivo: "Perfil del equipo" },
    ],
    omitidas: [
      { fase: "privilegio", porque: "El perfil no declara comando de privilegio: los comandos van en el modo actual." },
      { fase: "guardar", porque: "No se pidió guardar la configuración." },
    ],
  },
  pasos: [],
  dialogos: [],
  dialogoPendiente: null,
  abortado: false,
  motivoAborto: null,
  motivoAbortoTexto: null,
  executed: [],
  output: "",
  modoFinal: "usuario",
  modoIndeterminado: false,
  promptFinal: "[admin@core-r1] >",
  entramosEnConfig: false,
  guardado: false,
  code: "PLAN_ONLY",
  verificacion: null,
  message: "Plan calculado SIN escribir nada: 3 línea(s) que se escribirían y 2 omitida(s) por el perfil del equipo.",
};

const APPLIED_VERIFIED = {
  ...PLAN_ONLY,
  dryRun: false,
  escrito: true,
  plan: { lineas: PLAN_ONLY.plan.lineas.slice(0, 2), omitidas: [] },
  pasos: [
    { fase: "config", comando: "/ip address add address=10.0.0.1/24", estado: "enviado", output: "", paged: false, pages: 0 },
    { fase: "salida", comando: "/exit", estado: "enviado", output: "", paged: false, pages: 0 },
  ],
  executed: ["/ip address add address=10.0.0.1/24", "/exit"],
  guardado: true,
  code: null,
  verificacion: {
    pedidos: ["/ip address print"],
    resultados: [{ comando: "/ip address print", output: "address=10.0.0.1/24 interface=ether1", endReason: "idle" }],
    completa: true,
    motivo: null,
  },
  message: undefined,
};

const APPLIED_UNVERIFIED = {
  ...APPLIED_VERIFIED,
  code: "NO_VERIFICADO",
  verificacion: {
    pedidos: ["show running-config"],
    resultados: [],
    completa: false,
    motivo: "No se pudo leer la salida de verificación en el plazo de espera.",
  },
  message: "NO VERIFICADO: no se ha podido leer la configuración aplicada.",
};

const PENDING_DIALOG = {
  ...APPLIED_VERIFIED,
  code: "DIALOGO_PENDIENTE",
  abortado: true,
  motivoAborto: "pregunta_al_usuario",
  motivoAbortoTexto:
    "El equipo pidió una confirmación que no es del motor: 'Proceed? [y/N]'.",
  pasos: [
    {
      fase: "config",
      comando: "/system reboot",
      estado: "dialogo",
      output: "Proceed? [y/N]",
      paged: false,
      pages: 0,
      detail: "Diálogo pendiente de respuesta del usuario.",
    },
  ],
  executed: ["/system reboot"],
  dialogoPendiente: {
    texto: "Proceed? [y/N]",
    tipo: "pregunta_al_usuario",
    fase: "config",
    pattern: "\\[y/N\\]",
    respuesta: "",
    motivo: "Pregunta al usuario: el motor no contesta.",
  },
  verificacion: null,
  message: "La configuración se paró en un diálogo del equipo.",
};

const SUB_MODE = {
  ...APPLIED_VERIFIED,
  abortado: true,
  motivoAborto: "no_se_sale_de_config",
  motivoAbortoTexto:
    "La consola sigue en un sub-modo de configuración de interfaz; el comando de salida del perfil no lo saca.",
  salioDeConfig: false,
  avisoSalida: "Quedó en (config-if): el comando de salida no consiguió salir.",
  modoFinal: "config",
  entramosEnConfig: true,
  promptFinal: "R1(config-if)#",
};

const TERMINAL_NO_PROMPT = {
  success: false,
  code: "TERMINAL_NOT_RESPONDING",
  sessionId: "ses-1",
  deviceName: "core-r1",
  vendor: "mikrotik",
  prompt: null,
  message: "No se pudo configurar: la consola no tiene un prompt listo y no se escribió nada.",
  motivoSinPrompt: "login_pendiente",
  sinPrompt: {
    motivo: "login_pendiente",
    pendiente: "MikroTik Login:",
    ultimaLinea: "MikroTik Login:",
    consejo:
      "La consola está pidiendo autenticación (\"MikroTik Login:\") y el agente NUNCA teclea credenciales por ti: autentícate tú en la terminal y vuelve a intentarlo.",
  },
};

const SEND_COMMAND_OK = {
  success: true,
  sessionId: "ses-1",
  command: "show version",
  executed: ["show version"],
  removed: [],
  output: "Cisco IOS XE Software, Version 17.9",
  prompt: "R1#",
  endReason: "idle",
  timedOut: false,
  elapsedMs: 812,
  paged: false,
  pages: 0,
  pagerVariant: null,
  recortado: false,
  motivoCorte: null,
  despertar: null,
};

const SEND_COMMAND_DIAGNOSTIC = {
  ...SEND_COMMAND_OK,
  paged: true,
  pages: 3,
  pagerVariant: "--More--",
  recortado: false,
  motivoCorte: "eco_solo_prompt",
  despertar: { intentos: 1, motivoFinal: "la consola seguía esperando una tecla" },
};

const SEND_COMMAND_NO_OUTPUT = {
  ...SEND_COMMAND_OK,
  success: false,
  code: "NO_OUTPUT",
  executed: ["show ip int brief"],
  output: "",
  message:
    "El comando se envió a la consola pero no volvió ninguna salida en 20000 ms (plazo agotado). No des por hecho que se ejecutó.",
};

const READ_TERMINAL_LOGIN = {
  success: true,
  sessionId: "ses-1",
  deviceName: "core-r1",
  protocol: "telnet",
  alive: true,
  prompt: null,
  motivoSinPrompt: "login_pendiente",
  pendiente: "MikroTik Login:",
  ultimaLinea: "MikroTik Login:",
  lines: ["MikroTik Login:"],
};

const RAG_JSON = json({
  documents: ["doc"],
  metadatas: [{ title: "Manual VRP", score: 0.9, mode: "hybrid" }],
  mode: "hybrid",
});

const DEVICES_JSON = json({
  providers: [{ id: "p1", name: "R1", protocol: "SSH", status: "ACTIVE", host: "10.0.0.1", serialPort: null }],
});

const WEB_TEXT = "[1] Manual de IOS\nURL: https://www.cisco.com/ios\nDescripción: Guía de CLI\n\n";

section("configure_device · PLAN_ONLY (simulación)");
{
  const cycle = parseCicloConfiguracion(json(PLAN_ONLY));
  check("se detecta", cycle !== null);
  check("codigo PLAN_ONLY", cycle?.codigo === "PLAN_ONLY");
  check("dryRun", cycle?.dryRun === true);
  check("escrito = false", cycle?.escrito === false);
  check("plan con 3 líneas", cycle?.plan.lineas.length === 3);
  check("omitidas con su motivo", cycle?.plan.omitidas[0]?.porque.includes("modo actual") === true);
  check("pasos vacíos", cycle?.pasos.length === 0);
  const situation = cycle ? situacionConfiguracion(cycle) : null;
  check("situación = plan", situation?.situacion === "plan", situation?.situacion);
  check(
    "el plan nunca dice que se aplicó",
    situation ? !/aplicad|verificad|completad/i.test(situation.explicacion + situation.titulo) : false,
  );
  check("tono informativo", situation?.tono === "info");
}

section("configure_device · aplicado y verificado");
{
  const cycle = parseCicloConfiguracion(json(APPLIED_VERIFIED));
  check("se detecta", cycle !== null);
  check("escrito = true", cycle?.escrito === true);
  check("pasos con estado enviado", cycle?.pasos[0]?.estado === "enviado");
  check("verificación completa", cycle?.verificacion?.completa === true);
  check("guardado", cycle?.guardado === true);
  const situation = cycle ? situacionConfiguracion(cycle) : null;
  check("situación = aplicada_verificada", situation?.situacion === "aplicada_verificada", situation?.situacion);
  check("tono ok", situation?.tono === "ok");
  check("no está en sub-modo", cycle ? quedoEnSubModo(cycle) === false : false);
}

section("configure_device · aplicado SIN verificar");
{
  const cycle = parseCicloConfiguracion(json(APPLIED_UNVERIFIED));
  check("se detecta", cycle !== null);
  check("codigo NO_VERIFICADO", cycle?.codigo === "NO_VERIFICADO");
  check("verificación incompleta", cycle?.verificacion?.completa === false);
  const situation = cycle ? situacionConfiguracion(cycle) : null;
  check("situación = aplicada_sin_verificar", situation?.situacion === "aplicada_sin_verificar", situation?.situacion);
  check("avisa en el texto, no solo en el color", situation?.explicacion.includes("no se ha podido leer") === true);
  check("tono de aviso", situation?.tono === "aviso");
}

section("configure_device · diálogo pendiente");
{
  const cycle = parseCicloConfiguracion(json(PENDING_DIALOG));
  check("se detecta", cycle !== null);
  check("codigo DIALOGO_PENDIENTE", cycle?.codigo === "DIALOGO_PENDIENTE");
  check("texto literal del diálogo intacto", cycle?.dialogoPendiente?.texto === "Proceed? [y/N]");
  check("tipo del diálogo", cycle?.dialogoPendiente?.tipo === "pregunta_al_usuario");
  check("sin respuesta escrita", cycle?.dialogoPendiente?.respuesta === "");
  check("paso marcado como diálogo", cycle?.pasos[0]?.estado === "dialogo");
  const situation = cycle ? situacionConfiguracion(cycle) : null;
  check("situación = dialogo_pendiente", situation?.situacion === "dialogo_pendiente", situation?.situacion);
  check("manda a la terminal", situation?.explicacion.includes("terminal") === true);
}

section("configure_device · consola en sub-modo");
{
  const cycle = parseCicloConfiguracion(json(SUB_MODE));
  check("se detecta", cycle !== null);
  check("motivoAborto = no_se_sale_de_config", cycle?.motivoAborto === "no_se_sale_de_config");
  check("prompt final conservado", cycle?.promptFinal === "R1(config-if)#");
  check("quedó en sub-modo", cycle ? quedoEnSubModo(cycle) === true : false);
  const situation = cycle ? situacionConfiguracion(cycle) : null;
  check("situación = abortada", situation?.situacion === "abortada", situation?.situacion);
}

section("configure_device · sin prompt (login pendiente)");
{
  const cycle = parseCicloConfiguracion(json(TERMINAL_NO_PROMPT));
  check("el ciclo no se inventa", cycle === null);
  const diag = parseDiagnosticoConsola(json(TERMINAL_NO_PROMPT));
  check("se detecta como diagnóstico", diag !== null);
  check("motivo login_pendiente", diag?.sinPrompt?.motivo === "login_pendiente");
  check("etiqueta legible", diag?.sinPrompt?.etiqueta === "Autenticación pendiente");
  check("consejo del backend", diag?.sinPrompt?.consejo.includes("autentícate tú") === true);
  check("texto en pantalla", diag?.sinPrompt?.pendiente === "MikroTik Login:");
  check("código TERMINAL_NOT_RESPONDING", diag?.codigo === "TERMINAL_NOT_RESPONDING");
}

section("send_command · diagnósticos");
{
  const cleanOutput = parseDiagnosticoConsola(json(SEND_COMMAND_OK));
  check("un comando correcto no genera tarjeta de diagnóstico", cleanOutput === null);

  const diag = parseDiagnosticoConsola(json(SEND_COMMAND_DIAGNOSTIC));
  check("se detecta", diag !== null);
  check("paginación", diag?.paged === true && diag?.pages === 3);
  check("variante de paginador", diag?.pagerVariant === "--More--");
  check("motivo de recorte del eco", diag?.motivoCorte === "eco_solo_prompt");
  check("consola despertada", diag?.despertar?.intentos === 1);
  check("salida de consola conservada", diag?.texto?.includes("Cisco IOS XE") === true);

  const noOutput = parseDiagnosticoConsola(json(SEND_COMMAND_NO_OUTPUT));
  check("NO_OUTPUT detectado", noOutput?.codigo === "NO_OUTPUT");
  check("NO_OUTPUT con su mensaje", noOutput?.mensaje?.includes("no volvió ninguna salida") === true);
}

section("read_terminal · login pendiente");
{
  const diag = parseDiagnosticoConsola(json(READ_TERMINAL_LOGIN));
  check("se detecta", diag !== null);
  check("motivo login_pendiente", diag?.sinPrompt?.motivo === "login_pendiente");
  check("sin consejo del backend usa el de respaldo", diag?.sinPrompt?.consejo.includes("nunca las teclea") === true);
  check("texto de `lines` como salida", diag?.texto === "MikroTik Login:");
}

section("no se cuela en el resto de salidas");
{
  check("web search no es ciclo", parseCicloConfiguracion(WEB_TEXT) === null);
  check("web search no es diagnóstico", parseDiagnosticoConsola(WEB_TEXT) === null);
  check("rag no es ciclo", parseCicloConfiguracion(RAG_JSON) === null);
  check("rag no es diagnóstico", parseDiagnosticoConsola(RAG_JSON) === null);
  check("dispositivos no es ciclo", parseCicloConfiguracion(DEVICES_JSON) === null);
  check("dispositivos no es diagnóstico", parseDiagnosticoConsola(DEVICES_JSON) === null);
  check("texto plano no es nada", parseCicloConfiguracion("salida de consola") === null);
  check("JSON vacío no es nada", parseCicloConfiguracion("{}") === null);
  check("los otros parsers siguen vivos", parseWebResults(WEB_TEXT).length === 1);
  check("rag sigue vivo", parseRagOutput(RAG_JSON)?.fuentes.length === 1);
  check("dispositivos siguen vivos", parseDispositivos(DEVICES_JSON)?.length === 1);
}

section("acotado de textos largos");
{
  const longText = "x".repeat(500);
  check("acota a 220 por defecto", acotar(longText).endsWith("…") && acotar(longText).length === 221);
  check("no toca lo corto", acotar("motivo corto") === "motivo corto");
  check("detecta el recorte", fueAcotado(longText) === true && fueAcotado("corto") === false);
  check("tolera null", acotar(null) === "" && fueAcotado(undefined) === false);
  const withLongCause = {
    ...PLAN_ONLY,
    plan: {
      ...PLAN_ONLY.plan,
      omitidas: [{ fase: "privilegio", porque: longText }],
    },
  };
  const cycle = parseCicloConfiguracion(json(withLongCause));
  check("el motivo íntegro se conserva en el modelo", cycle?.plan.omitidas[0]?.porque === longText);
  check("el render lo acota", acotar(cycle?.plan.omitidas[0]?.porque).length === 221);
}

section("caducidad de la aprobación");
{
  const NOW = 1_700_000_000_000;
  const at = (ms: number) => new Date(NOW + ms).toISOString();

  check("sin expiresAt no se inventa un plazo", textoCaducidad("", NOW) === null);
  check("caducidad no parseable → nada", textoCaducidad("no-es-fecha", NOW) === null);
  check("null → nada", textoCaducidad(null, NOW) === null);

  const nineMin = textoCaducidad(at(9 * 60_000 + 30_000), NOW);
  check("muestra minutos", nineMin?.texto === "caduca en 10 min", nineMin?.texto);
  check("no expirada todavía", nineMin?.expirada === false);

  const fortySec = textoCaducidad(at(40_000), NOW);
  check("último minuto en segundos", fortySec?.texto === "caduca en 40 s", fortySec?.texto);

  const expired = textoCaducidad(at(-1), NOW);
  check("expirada en pasado", expired?.texto === "expirada" && expired?.expirada === true);
  check("restante 0 al expirar", expired?.restanteMs === 0);

  const exact = textoCaducidad(at(0), NOW);
  check("expirada en el instante exacto", exact?.expirada === true);

  check("cambio antes de 1 s en el último minuto", proximoCambioCaducidad(at(40_000), NOW) > 0 && proximoCambioCaducidad(at(40_000), NOW) <= 1000);
  check("cambio dentro del minuto en el último minuto", (() => {
    const step = proximoCambioCaducidad(at(59_000), NOW);
    return step > 0 && step <= 1000;
  })());
  check("cambio ~1 min antes del minuto", (() => {
    const step = proximoCambioCaducidad(at(5 * 60_000), NOW);
    return step > 0 && step <= 60_000;
  })());
  check("expirada no vuelve a cambiar", Number.isFinite(proximoCambioCaducidad(at(-5), NOW)) === false);
  check("sin plazo no arma temporizador", Number.isFinite(proximoCambioCaducidad("", NOW)) === false);

  check("el texto avanza al pasar el segundo", textoCaducidad(at(59_000), NOW)?.texto === "caduca en 59 s" && textoCaducidad(at(59_000), NOW + 1_000)?.texto === "caduca en 58 s");
  check("el minuto cede a los segundos en el último minuto", textoCaducidad(at(60_000), NOW)?.texto === "caduca en 1 min" && textoCaducidad(at(60_000), NOW + 1_000)?.texto === "caduca en 59 s");
}

section("título legible de herramienta");
{
  check("snake_case traducido", etiquetaHerramienta("search_knowledge_base") === "Consulta en base de conocimiento");
  check("camelCase traducido", etiquetaHerramienta("sendSerialCommand") === "Envío por consola serial");
  check("built-in de Deep Agents traducida", etiquetaHerramienta("ls") === "Listado de archivos");
  check("sin underscored feo", etiquetaHerramienta("write_todos") === "Plan del turno");
  check("tool del sistema", etiquetaHerramienta("deleteCronJob") === "Baja de tarea programada");
  check("respaldo humanizado camelCase", etiquetaHerramienta("nuevaToolRara") === "Nueva Tool Rara", etiquetaHerramienta("nuevaToolRara"));
  check("respaldo humanizado snake_case", etiquetaHerramienta("algo_nuevo_del_hub") === "Algo nuevo del hub");
  check("nombre vacío", etiquetaHerramienta("") === "Herramienta");
  check(
    "todos los títulos caben en una línea de móvil",
    Object.values(ETIQUETA_TOOL).every((text) => text.length <= 32 && !/[_]/.test(text)),
    JSON.stringify(Object.entries(ETIQUETA_TOOL).filter(([, text]) => text.length > 32 || /_/.test(text))),
  );
}

section("errores cortos y accionables");
{
  const noMarker = resumirError("Error enviando comando por puerto COM3");
  check("fallo de conexión → reintentable", noMarker.reintentable === true, noMarker.que);
  check("fallo de conexión: qué hacer", noMarker.accion.includes("reconecta"), noMarker.accion);
  check("fallo SSH también", resumirError("connect ETIMEDOUT 10.0.0.1:22").reintentable === true);

  const roleError = resumirError("[BLOQUEADO_ROL] no puedes");
  check("marcador de rol traducido", roleError.que.includes("rol"), roleError.que);
  check("no repite el marcador técnico", !roleError.que.includes("[") && !roleError.que.includes("]"), roleError.que);
  check("no reintentable un bloqueo de rol", roleError.reintentable === false);

  const generic = resumirError(JSON.stringify({ error: "Traceback (most recent call last): File x" }));
  check("sin_marker no inventa la causa", generic.que === "La herramienta no pudo completar la operación.", generic.que);
  check("apunta a detalles técnicos", generic.accion.includes("Detalles técnicos"), generic.accion);

  check("error sin salida no rompe", resumirError(undefined).que.length > 0);
  check("cancelación con marcador", explicacionCancelacion("[APROBACION_RECHAZADA] no").includes("Cancelaste"), explicacionCancelacion("[APROBACION_RECHAZADA] no"));
  check("cancelación sin marcador no inventa", explicacionCancelacion("").includes("canceló"), explicacionCancelacion(""));
  check(
    "los mensajes caben en dos líneas",
    [generic.que, noMarker.que, noMarker.accion, roleError.que, roleError.accion].every((text) => text.length <= 90),
    JSON.stringify([generic.que, noMarker.que, noMarker.accion, roleError.que, roleError.accion]),
  );
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} · ${total - failures}/${total} checks en verde`,
);
if (failures > 0) process.exitCode = 1;
