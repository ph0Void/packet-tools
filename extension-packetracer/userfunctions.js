// Marca de build: debe coincidir con el mtime de ESTE fichero en el repo.
// La suite test-pt la compara para avisar si PT corre una extensión antigua.
var EXTENSION_BUILD = "2026-10-03T03:26:07";

function fail(prefix, err) {
  var msg = (err && (err.message || String(err))) || "unknown error";
  return { success: false, error: prefix ? prefix + ": " + msg : msg };
}

// Mensaje de un error de Packet Tracer acotado a 200 chars. Se usa donde el
// payload DEBE mantener su forma (el ping, que el backend lee como contrato) y
// aun asi quiere decir que paso.
function __mensajeDeError(err) {
  var msg = (err && (err.message || String(err))) || "error desconocido";
  msg = String(msg);
  if (msg.length > 200) msg = msg.substring(0, 200);
  return msg;
}

// ===========================================================================
//  UTILIDADES INTERNAS DEL MOTOR DE COMANDOS
//  (no son herramientas: no llevan entrada en TOOL_ARGS)
// ===========================================================================

// Resuelve la línea de entrada del dispositivo: consola IOS si existe,
// si no la línea de terminal de PC/Server/Laptop.
function __resolveLine(device) {
  var line = null;
  try {
    if (device && device.getConsoleLine !== undefined) line = device.getConsoleLine();
  } catch (e1) {
    line = null;
  }
  if (!line) {
    try {
      if (device && device.getCommandLine !== undefined) line = device.getCommandLine();
    } catch (e2) {
      line = null;
    }
  }
  return line || null;
}

// Modo por defecto de enterCommand: IOS (routers/switches) -> "enable"
// (privilegiado), que es donde viven los comandos `show`; los comandos de
// configuracion pasan siempre mode:"global" explicito desde su caller.
// Hosts y resto de equipos -> "user".
function __defaultMode(device) {
  var type = -1;
  try {
    type = device.getType();
  } catch (e) {
    type = -1;
  }
  if (type === 0 || type === 1 || type === 16) return "enable";
  return "user";
}

// Espera activa acotada: el motor de scripts de PT no expone timers sincronos.
function __busyWait(ms) {
  var start = Date.now();
  while (Date.now() - start < ms) {
    // espera activa deliberada y acotada por el caller
  }
}

// ---------------------------------------------------------------------------
// CORTE DE LA SALIDA DE CONSOLA (`__corte`)
//
// `getOutput()` es ACOTADO: cuando la consola de PT se desborda descarta la
// CABEZA (el banner de arranque, la configuracion anterior) y el `before`
// capturado antes del comando deja de ser PREFIJO del buffer. El codigo
// anterior caia entonces a su fallback `return text`, que devolvia el BUFFER
// ENTERO: medido en PT 9 (2911, `packages/server/scripts/pt-diag-slice.ts`), un
// `show ip route` devolvio 5147 chars empezando por "System Bootstrap, Version
// 15.1(4)M4 ... Total memory size = 512 MB" en vez de los 526 de su salida
// real. La suite test-pt barre el payload y marca FALLO por consola sucia.
//
// ESTRATEGIA (la primera que aplica gana). El ANCLA es el texto del comando
// enviado: PT lo hace eco en la consola, y como se acaba de teclear esta
// pegado al FINAL del buffer, asi que sobrevive a la perdida de cabeza. Es la
// tecnica del MCP de referencia (`examples/mcp-example/src/sim/runner.ts:36-48`,
// `readSinceMarkerJs`), que nunca fia del snapshot y solo usa
// `getOutput().lastIndexOf(marcador)`.
//   1) `before` sigue siendo prefijo de `full` -> corte por longitud. Es el
//      caso normal (una sola lectura del buffer): mismo resultado y mismo
//      coste que antes.
//   2) NO es prefijo, pero aparece el eco del comando -> corte desde el ultimo
//      `lastIndexOf` del ancla (sobrevive al desbordamiento).
//   3) Ni prefijo ni ancla (el comando llego mutilado, p. ej. `how ip route` en
//      vez de `show ip route`, y por eso tampoco esta su eco) -> VENTANA FINAL
//      acotada de `CORTE_VENTANA_FINAL` chars, marcada como NO limpia. NUNCA el
//      buffer entero: preferimos una ventana reciente y delata a un `output`
//      poco fiable antes que devolver basura de hace diez minutos como si
//      fuera la salida del comando.
//
// ANCLAS candidatas, de mas a menos especificidad (solo la 1 da corte limpio):
//   1) el comando tal cual se envio, con los espacios internos colapsados: si
//      aparece, el corte es EXACTO y se da por limpio (`ancla`);
//   2) sus DOS ULTIMAS PALABRAS (`show ip interface brief` -> `interface
//      brief`), por si PT altero el espaciado del eco;
//   3) su ULTIMA PALABRA (`show running-config` -> `running-config`,
//      `configure terminal` -> `terminal`): es justo lo que sobrevive a que PT
//      se coma un caracter del comando (`show running-config` ->
//      `how running-config`, que sigue conteniendo `running-config`). Being tan
//      corto puede colarse dentro de la PROPIA salida del comando, asi que ese
//      corte se marca como APROXIMADO y NO limpio (`ancla_parcial`): es
//      exactamente el caso del comando mutilado, y asi la degradacion se ve en
//      el payload en vez de disfrazarse de corte limpio.
// La busqueda exige LIMITES DE PALABRA (asi `R1#show ip route` cuenta, con el
// prompt pegado delante, y `ip route` no casa dentro de `ip route-map`) y que
// el eco este en la ventana final `CORTE_VENTANA_ANCLA`: si el comando no llego
// a escribirse, no se acepta un ancla viejisima del buffer.
// ---------------------------------------------------------------------------

// Ventana final en la que se acepta el eco del comando como ancla. Por encima
// del tope medido del buffer de PT (~8 KB: 7983 chars era el mayor observado),
// para que el limite acote de verdad y no descarte el eco recien tecleado.
var CORTE_VENTANA_ANCLA = 12000;
// Tope duro de la salida del comando cuando no hay ni prefijo ni ancla.
var CORTE_VENTANA_FINAL = 4000;
// Espera tras teclear el paginador (`--More--`).
var CORTE_PAUSA_PAGINA = 60;
// Tope de pagos del paginador en `__pageThrough` (el de antes).
var PAGINADOR_MAX_PAGINAS = 40;

// String seguro de cualquier valor (getOutput() devuelve texto, pero en las
// pruebas y en los try/catch puede llegar null/undefined).
function __texto(valor) {
  return valor === undefined || valor === null ? "" : String(valor);
}

// Colapsa espacios (incluidos saltos de linea) y recorta extremos: PT puede
// teclear el eco del comando con espaciado irregular.
function __colapsar(valor) {
  return __texto(valor)
    .replace(/\s+/g, " ")
    .replace(/^\s+|\s+$/g, "");
}

// Anclas candidatas de un comando, de mas a menos especificidad. Solo la
// primera (el comando entero) permite dar el corte por limpio.
function __anclasDe(ancla) {
  var out = [];
  var completa = __colapsar(ancla);
  if (completa) out.push(completa);
  var palabras = completa.split(" ");
  if (palabras.length >= 2) {
    var dos = palabras[palabras.length - 2] + " " + palabras[palabras.length - 1];
    if (dos && dos !== completa) out.push(dos);
  }
  if (palabras.length >= 1) {
    var una = palabras[palabras.length - 1];
    if (una && out.indexOf(una) === -1) out.push(una);
  }
  return out;
}

// Ultima aparicion de `aguja` en `texto` respetando limites de palabra, para
// que un ancla corta (`end`, `ip route`) no case dentro de otra palabra
// (`append`, `ip route-map`). `menor` acota la busqueda hacia atras.
function __indiceAncla(texto, aguja, menor) {
  if (!aguja) return -1;
  var pos = texto.lastIndexOf(aguja);
  while (pos >= 0 && pos >= menor) {
    var antes = pos > 0 ? texto.charAt(pos - 1) : "";
    var despues = pos + aguja.length < texto.length ? texto.charAt(pos + aguja.length) : "";
    var okAntes = !antes || !/[A-Za-z0-9_./:-]/.test(antes);
    var okDespues = !despues || !/[A-Za-z0-9_./:-]/.test(despues);
    if (okAntes && okDespues) return pos;
    if (pos === 0) return -1;
    pos = texto.lastIndexOf(aguja, pos - 1);
  }
  return -1;
}

// El corte de verdad, con su veredicto. Contrato:
//   {texto, limpio, motivo}
// `motivo` es un codigo corto en espanol (nunca texto de consola en ingles,
// que la suite test-pt lee como marca de consola sucia):
//   "prefijo"       -> el snapshot era prefijo: corte limpio por longitud
//   "ancla"         -> corte limpio por el eco exacto del comando
//   "ancla_parcial" -> corte por el eco aproximado (dos ultimas palabras):
//                      util pero NO de fiar, se marca como no limpio
//   "sin_before"    -> no habia snapshot legible: ventana final, NO limpio
//   "sin_ancla"     -> ni prefijo ni ancla: ventana final, NO limpio
function __corte(full, before, ancla) {
  var text = __texto(full);
  var prev = __texto(before);

  // 1) Snapshot intacto: caso normal, no cambia nada respecto al codigo anterior.
  if (prev && text.length >= prev.length && text.substring(0, prev.length) === prev) {
    return { texto: text.substring(prev.length), limpio: true, motivo: "prefijo" };
  }

  // Ventana final para los casos degradados (tope duro, nunca el buffer entero).
  var cola =
    text.length > CORTE_VENTANA_FINAL
      ? text.substring(text.length - CORTE_VENTANA_FINAL)
      : text;

  // 2) El buffer perdio la cabeza: se corta por el eco del comando.
  var desde = text.length > CORTE_VENTANA_ANCLA ? text.length - CORTE_VENTANA_ANCLA : 0;
  var anclas = __anclasDe(ancla);
  for (var a = 0; a < anclas.length; a++) {
    var pos = __indiceAncla(text, anclas[a], desde);
    if (pos < 0) continue;
    // La primera ancla (el comando entero) es exacta; las siguientes son
    // aproximadas y quedan marcadas como no limpias.
    if (a === 0) return { texto: text.substring(pos), limpio: true, motivo: "ancla" };
    return { texto: text.substring(pos), limpio: false, motivo: "ancla_parcial" };
  }

  // 3) Ni prefijo ni ancla: ventana final acotada y marcada como no fiable.
  if (!prev) return { texto: cola, limpio: false, motivo: "sin_before" };
  return { texto: cola, limpio: false, motivo: "sin_ancla" };
}

// getOutput() es acumulativo: recortamos todo lo que ya existia antes del
// comando.
//
// OJO: esta envoltura esta SIN USAR (no la llama nadie: todos los cortes del
// fichero pasan por `__corte`, que además devuelve el veredicto `limpio`/`motivo`).
// Se deja por si algo fuera de aqui la busca, pero no se debe tocar ni ampliar su
// uso: lo que hay que revisar cuando cambie el corte es `__corte`.
function __sliceAfter(full, before, ancla) {
  return __corte(full, before, ancla).texto;
}

// Envia un comando por la linea de consola respetando el modo de IOS.
// Si la linea no admite el 2.º argumento, reintenta con la firma antigua.
function __sendCommand(line, device, cmd, mode) {
  if (line && line.enterCommand !== undefined) {
    try {
      return line.enterCommand(cmd, mode);
    } catch (e1) {
      return line.enterCommand(cmd);
    }
  }
  if (device && device.enterCommand !== undefined) {
    return device.enterCommand(cmd, mode);
  }
  throw new Error("enterCommand no disponible en este dispositivo");
}

// Decide el estado del comando mirando la salida cuando PT no informa.
//
// SEMANTICA DEL RESULTADO (contrato con el backend, que trata `status` como un
// string libre y lo reenvia tal cual al agente):
//   "unknown" -> la salida esta VACIA o es solo whitespace: NO se puede afirmar
//     que el equipo ejecuto el comando (consola bloqueada por un lookup DNS,
//     dialogo de configuracion inicial abierto, equipo dormido...). Un output
//     vacio NUNCA es "ok": era el falso OK que escondia los fallos de la suite.
//   "error"   -> la salida trae marcas de error (`% Invalid input...`) o marcas
//     de consola sucia (dialogo, Press RETURN, "Translating..."): el comando no
//     llego a ejecutarse o IOS lo rechazo.
//   "ok"      -> hay salida util y no trae ninguna de las marcas anteriores.
function __statusFromOutput(output) {
  var text = output === undefined || output === null ? "" : String(output);
  if (!text.replace(/\s+/g, "")) return "unknown";
  if (/(invalid|incomplete|ambiguous|% ?error)/i.test(text)) return "error";
  if (
    /initial configuration dialog|please answer 'yes' or 'no'|press return to get started|translating "/i.test(
      text
    )
  ) {
    return "error";
  }
  return "ok";
}

// Normaliza el CommandStatus devuelto por PT (enum, QPair o array) a
// "ok"/"error"/"unknown".
//
// El statusRaw explicito de PT manda si lo hay, SALVO en un caso: si la salida
// esta vacia el resultado jamas puede ser "ok" (se devuelve "unknown"). Es la
// unica regla que se impone por encima de PT: un comando que no dejo rastro en
// la consola no puede reportarse como ejecutado.
function __resolveStatus(statusRaw, output) {
  var st = statusRaw;
  if (st && typeof st === "object") {
    if (st.first !== undefined) st = st.first;
    else if (st.status !== undefined) st = st.status;
    else if (typeof st.length === "number" && st.length > 0) st = st[0];
  }

  var estado;
  if (st === undefined || st === null) {
    estado = __statusFromOutput(output);
  } else if (typeof st === "boolean") {
    estado = st ? "ok" : "error";
  } else {
    var low = String(st).toLowerCase();
    if (low.indexOf("error") !== -1 || low.indexOf("fail") !== -1 || low.indexOf("invalid") !== -1) {
      estado = "error";
    } else if (
      low === "ok" ||
      low === "success" ||
      low === "true" ||
      low.indexOf("success") !== -1 ||
      low.indexOf("valid") !== -1
    ) {
      estado = "ok";
    } else if (typeof st === "number") {
      // Convencion PT: 0 = exito (la misma que ADD_PDU_ERROR en sendPdu)
      estado = st === 0 ? "ok" : __statusFromOutput(output);
    } else {
      estado = __statusFromOutput(output);
    }
  }

  // Guardia final: sin salida no hay "ok", ni siquiera con statusRaw explicito.
  var texto = output === undefined || output === null ? "" : String(output);
  if (estado === "ok" && !texto.replace(/\s+/g, "")) return "unknown";
  return estado;
}

// Un golpe al paginador `--More--` de la consola (tecla espacio) con su espera.
// Devuelve true si se pudo teclear. UNICO punto del fichero que paga el
// paginador: lo comparten `__pageThrough` y `__esperarConsolaInactiva` (no se
// duplica la logica de teclear).
// Ultimo metodo con el que se ha pagado el paginador (`""` = ninguno). Se expone
// en el payload para que se sepa que via funciona en PT 9 sin adivinarlo.
var __PAGINADOR_VIA_ULTIMA = "";

// Paga una pagina del paginador (`--More--`).
//
// MEDIDO en PT 9 (no es una teoria: `scripts/pt-diag-runningconfig.ts`, build
// 2026-10-02T15:14:15, con `payload.pagerVia:"enterCommandEspacio"` y
// `payload.pagerVisto:true`):
//   * `line.enterChar(32)` es un NO-OP, con UN argumento (`enterChar(32)`) y
//     tambien con los DOS que declara la API oficial (`enterChar(32, null)`).
//     Con `enterChar` el buffer se queda en ` --More-- ` indefinidamente y
//     `show running-config` no termina nunca: el agente agotaba 27,5 s y
//     devolvia el banner de arranque como si fuera la salida.
//   * Lo que SI paga la pagina es `line.enterCommand(" ")`: un espacio enviado
//     como comando. Todos los comandos del sistema pasan por `enterCommand`, y
//     el paginador se come el espacio y muestra la siguiente pagina.
//   * El evento `moreDisplayed()` SI dispara y es la senal fiable de que el
//     paginador esta abierto (mucho mas fiable que buscar la cadena `--More--`,
//     que sale como " --More-- " con espacios o no sale). Lo consume
//     `runCommandAsync` -> `payload.pagerVisto`.
//
// ORDEN de la escalera: primero lo que esta MEDIDO que funciona. `enterChar` se
// queda al FINAL como respaldo documentado (no se borra: si `enterCommand` no
// existiera en alguna build, es lo unico que queda, y su coste es una llamada
// que no cambia el buffer y se descarta).
//
// Escalera, con cada escalon VERIFICADO contra el buffer (si el buffer no cambia
// se pasa al siguiente, y `pagerVia` dice que via surtio efecto):
//   1) `enterCommand(" ")`    -> un espacio como comando: LA VIA QUE FUNCIONA
//   2) `enterCommand("\n")`   -> otro `enterCommand`, por si el espacio no basta
//   3) `enterChar(32, null)`  -> aridad oficial de PT 9 (NO-OP medido)
//   4) `enterChar(32)`        -> aridad corta (NO-OP medido, era la que usabamos)
function __pagarPagina(line, device) {
  if (!line) return false;
  var antes = String(__leerBuffer(line));
  var escalones = [
    {
      via: "enterCommandEspacio",
      usar: function () {
        __sendCommand(line, device, " ", "");
        return true;
      },
    },
    {
      via: "enterCommandNl",
      usar: function () {
        __sendCommand(line, device, "\n", "");
        return true;
      },
    },
    { via: "enterChar32null", usar: function () { return __enterChar(line, 32, true); } },
    { via: "enterChar32", usar: function () { return __enterChar(line, 32, false); } },
  ];
  for (var i = 0; i < escalones.length; i++) {
    var hecha = false;
    try {
      hecha = escalones[i].usar() === true;
    } catch (ePaginaEscalon) {
      hecha = false;
    }
    if (!hecha) continue;
    __busyWait(CORTE_PAUSA_PAGINA);
    __PAGINADOR_VIA_ULTIMA = escalones[i].via;
    if (String(__leerBuffer(line)) !== antes) return true;
  }
  return false;
}

// Si la salida contiene "--More--" paga la consola con la tecla espacio (que en
// PT 9 se teclea con `enterCommand(" ")`, medido: `enterChar` es no-op) en bucle
// acotado y limpia el marcador del texto devuelto. Cada pasada vuelve
// a cortar con `__corte` (mismo snapshot y mismo ancla que la llamada): si el
// buffer se desborda entre pagos, el corte por ancla evita el buffer entero.
//
// `corte` es el resultado de `__corte` (se acepta tambien un string por
// comodidad) y lo que sale vuelve a ser `{texto, limpio, motivo}`, con el
// veredicto del ULTIMO corte: si el pager no se pudo pagar se queda el corte ya
// hecho, tal cual.
function __pageThrough(line, corte, before, ancla, device) {
  var res =
    corte && typeof corte === "object"
      ? { texto: __texto(corte.texto), limpio: corte.limpio === true, motivo: __texto(corte.motivo) }
      : { texto: __texto(corte), limpio: true, motivo: "prefijo" };
  var guard = 0;
  while (res.texto.indexOf("--More--") !== -1 && guard < PAGINADOR_MAX_PAGINAS) {
    guard++;
    if (!__pagarPagina(line, device)) break;
    res = __corte(__leerBuffer(line), before, ancla);
  }
  res.texto = res.texto.split("--More--").join("");
  return res;
}

// Ultima linea del buffer de consola, normalizada: sin CRLF, espacios de los
// extremos recortados, espacios internos colapsados y en minusculas.
function __ultimaLinea(buffer) {
  var texto = buffer === undefined || buffer === null ? "" : String(buffer);
  texto = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  texto = texto.replace(/^\s+|\s+$/g, "");
  var ultima = texto.substring(texto.lastIndexOf("\n") + 1);
  return ultima.replace(/\s+/g, " ").toLowerCase().replace(/^\s+|\s+$/g, "");
}

// Lectura protegida del buffer de consola: "" si la linea no existe, si
// getOutput() lanza o si devuelve algo que no sea texto. Todas las lecturas de
// `getOutput()` del despertar pasan por aqui (era un try/catch repetido).
function __leerBuffer(line) {
  if (!line || line.getOutput === undefined) return "";
  try {
    var v = line.getOutput();
    if (v === undefined || v === null) return "";
    return String(v);
  } catch (eLectura) {
    return "";
  }
}

// Marcas del ARRANQUE de un equipo IOS en el texto de consola. Son las que
// delatan que el buffer trae el banner de arranque (o el dialogo de
// configuracion inicial) y NO la salida del comando:
//   1) "System Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)..." +
//      "Copyright (c) ... Cisco Systems, Inc." + "Total memory size = 512 MB"
//   2) "Self decompressing the image :" seguido de la barra "#####"
//   3) "Press RETURN to get started!"
//   4) el dialogo inicial "...initial configuration dialog? [yes/no]:"
// Ninguna de ellas aparece en la salida de un `show ...` normal, asi que
// encontrarlas en el `output` de un comando significa que el equipo seguia
// arrancando y el comando NO llego a ejecutarse.
var RE_ARRANQUE =
  /system bootstrap|self decompressing|cisco systems, inc|#{4,}|press return to get started|initial configuration dialog|please answer|\[yes\/no\]/i;

// ¿El texto trae un bloque de arranque de IOS?
function __bloqueDeArranque(texto) {
  var t = texto === undefined || texto === null ? "" : String(texto);
  if (!t) return false;
  return RE_ARRANQUE.test(t);
}

// Igual, pero mirando solo los ultimos `chars` caracteres: `getOutput()` es
// ACUMULATIVO, asi que un banner de arranque de hace diez minutos sigue en el
// buffer y no debe contar como "arrancando ahora".
function __arranqueEnCola(texto, chars) {
  var t = texto === undefined || texto === null ? "" : String(texto);
  if (!t) return false;
  var n = typeof chars === "number" && chars > 0 ? chars : 1500;
  if (t.length > n) t = t.substring(t.length - n);
  return __bloqueDeArranque(t);
}

// Estado IOS a partir del TEXTO de un prompt: "config" (Router(config)#,
// Router(config-if)#...), "user" (Router>), "enable" (Router#) o "" si el
// texto no es un prompt (buffer vacio, dialogo inicial, Password:, lookup DNS
// en marcha, banner de arranque a medias...). En "" NO se teclea nada: el
// caller debe esperar a que haya prompt.
function __estadoPrompt(texto) {
  var t = texto === undefined || texto === null ? "" : String(texto);
  t = t.replace(/^\s+|\s+$/g, "");
  if (!t) return "";
  if (/\(config[^)]*\)#\s*$/.test(t)) return "config";
  if (/>\s*$/.test(t)) return "user";
  if (/#\s*$/.test(t)) return "enable";
  return "";
}

// Ultima linea no vacia de un texto de prompt, en minusculas y con los espacios
// internos colapsados. `getPrompt()` de PT puede devolver el prompt con el eco
// del comando tecleado o varios prompts apilados: nos quedamos con la ultima.
function __lineaPrompt(crudo) {
  var t = crudo === undefined || crudo === null ? "" : String(crudo);
  if (!t) return "";
  t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  var partes = t.split("\n");
  for (var i = partes.length - 1; i >= 0; i--) {
    var linea = partes[i].replace(/^\s+|\s+$/g, "");
    if (linea) return linea.replace(/\s+/g, " ").toLowerCase();
  }
  return "";
}

// `line.getPrompt()` si la API existe. Va en try/catch porque segun la version
// de PT puede no existir, no ser una funcion, o lanzar al pedirla: nunca debe
// romper la lectura del prompt (si falla, se cae al buffer, que siempre existe).
function __promptCrudo(line) {
  if (!line || typeof line.getPrompt !== "function") return "";
  try {
    return __lineaPrompt(line.getPrompt());
  } catch (ePromptApi) {
    return "";
  }
}

// Estado real de la consola IOS segun el prompt:
//
//   "config"  -> Router(config)#, Router(config-if)#, Router(config-router)#
//   "user"    -> Router>
//   "enable"  -> Router#
//   ""        -> sin prompt legible (buffer vacio, dialogo inicial, Password:,
//                lookup DNS en marcha, texto a medias...). En "" NO se
//                teclea nada: el caller debe esperar a que haya prompt.
//
// `line.getPrompt()` es la fuente PRIMARIA (la que usa el MCP de referencia en
// `generator.ts:320-333`): es mas fiable que parsear la ultima linea del buffer,
// que ademas arrastra el eco del comando que acabamos de teclear. La excepcion
// es el arranque: mientras el buffer trae marcas de arranque, PT puede devolver
// un prompt a medio formarse, y ahi manda la ultima linea del buffer (que es
// literalmente `#####` o el dialogo, es decir ""). Asi el prompt tambien exige
// el FINAL de una linea, que es justo la garantia que el despertar necesita.
// OJO: es una LECTURA, no un cambio de modo: PT ignora el 2.º argumento de
// enterCommand(cmd, mode) y el modo hay que lograrlo tecleando transiciones.
function __promptActual(line) {
  if (!line || line.getOutput === undefined) return "";
  var bruto = __leerBuffer(line);
  var porPrompt = __estadoPrompt(__promptCrudo(line));
  if (porPrompt && !__arranqueEnCola(bruto, 600)) return porPrompt;
  return __estadoPrompt(__ultimaLinea(bruto));
}

// ---------------------------------------------------------------------------
// CONSOLA INACTIVA: no mandar un comando con la consola ocupada.
//
// MEDIDO en PT 9 (`scripts/pt-diag-slice.ts` y sondas sobre el puente): con la
// consola ocupada, `enterCommand` pierde el PRIMER caracter del comando y sale
// `R1#how ip route` + `% Invalid input detected at '^' marker.`; era el segundo
// de los 4 FALLO de la suite test-pt. El otro efecto de la misma causa es que
// la salida se captura A MEDIAS: `show running-config` con waitMs 2500 devolvia
// 264 chars y el resto (el prompt final) aparebia en el buffer mas tarde.
//
// CRITERIO (estado observable, no presupuesto fijo): la consola esta INACTIVA
// cuando la ULTIMA linea del buffer es un prompt (`Router>`, `R1#`,
// `R1(config)#`) y no hay paginador pendiente. Es el mismo criterio que ya usa
// el despertar (`__promptActual`): PT solo escribe el prompt cuando ha
// terminado de volcar la salida del comando.
//
// COSTE EN EL CASO NORMAL: ~0 ms. Con `lecturas` = 1 basta con que la PRIMERA
// lectura vea el prompt y se sale sin ningun `__busyWait` (una llamada a
// getOutput()). La espera solo se paga si la consola esta ocupada de verdad:
// entonces se sondea cada `paso` ms exigiendo que la longitud del buffer sea
// ESTABLE en `lecturas` lecturas consecutivas, hasta `tope`.
//
// Cuando se agota el tope con la consola ocupada NO se bloquea al agente: se
// devuelve `inactiva:false` y el caller manda el comando igualmente dejando
// constancia en el payload (`consola_ocupada`). Bloquear aqui seria peor que
// el comando mal tecleado.
//
// Devuelve diagnostico, no un booleano: {inactiva, motivo, esperas}.
// `motivo` (codigos cortos en espanol): "prompt" (inactiva confirmada),
// "sin_confirmar" (prompt pero sin lectura estable todavía), "pager"
// (paginador pendiente), "creciendo" (la consola sigue escribiendo),
// "sin_linea" (no hay consola legible).
// ---------------------------------------------------------------------------

// Techo de la espera por consola inactiva ANTES de cada comando (~1,5 s: el
// typico comando ya ha terminado cuando se entra aqui, asi que no se paga).
var CONSOLA_OCUPADA_TOPE_MS = 1500;
// Paso del sondeo mientras se espera (no hace falta fino: solo se sondea cuando
// hay algo pendiente).
var CONSOLA_OCUPADA_PASO_MS = 120;
// Techo de la espera por consola inactiva DESPUES de cada comando (capturar la
// salida con PT ya habiendo terminado de escribirla). El paso son 100 ms: una
// lectura de mas para CONFIRMAR que el buffer dejo de crecer, que es lo que
// hacia que `show running-config` volviera cortado.
var CONSOLA_SALIDA_TOPE_MS = 1500;
var CONSOLA_SALIDA_PASO_MS = 100;
// Cola del buffer donde se busca el paginador pendiente (~400 chars).
var CONSOLA_OCUPADA_COLA = 400;
// Tope de pagos del paginador mientras se espera (propio, para no comerse el
// paso de sondeo si `enterChar` no existiera).
var CONSOLA_OCUPADA_MAX_PAGINAS = 8;

// Espera acotada a que la consola quede inactiva. `lecturas` = numero de
// lecturas consecutivas con la MISMA longitud del buffer que hacen falta para
// darla por estable (1 = basta la primera lectura, coste 0).
function __esperarConsolaInactiva(line, topeMs, lecturas, pasoMs, device) {
  var res = { inactiva: false, motivo: "sin_linea", esperas: 0 };
  if (!line || line.getOutput === undefined) return res;

  var tope = typeof topeMs === "number" && topeMs > 0 ? topeMs : CONSOLA_OCUPADA_TOPE_MS;
  var paso = typeof pasoMs === "number" && pasoMs > 0 ? pasoMs : CONSOLA_OCUPADA_PASO_MS;
  var quiere = typeof lecturas === "number" && lecturas > 1 ? lecturas : 1;
  var limite = Date.now() + tope;

  var largoPrev = -1;
  var estables = 0;
  var paginas = 0;
  var motivo = "creciendo";
  var inactiva = false;

  for (;;) {
    var bruto = __leerBuffer(line);
    var largo = bruto.length;
    var bajo = bruto.toLowerCase();
    var cola =
      bajo.length > CONSOLA_OCUPADA_COLA
        ? bajo.substring(bajo.length - CONSOLA_OCUPADA_COLA)
        : bajo;
    var paginando = cola.indexOf("--more--") !== -1;
    // El prompt se lee de la ULTIMA LINEA del buffer (no de getPrompt(), que
    // puede devolver el prompt con el eco del comando recien tecleado).
    var prompt = __estadoPrompt(__ultimaLinea(bruto)) !== "";

    if (largo === largoPrev) estables++;
    else {
      estables = 1;
      largoPrev = largo;
    }

    if (prompt && !paginando) {
      if (estables >= quiere) {
        inactiva = true;
        motivo = "prompt";
        break;
      }
      // Prompt pero sin lectura estable todavía: se confirma con un paso mas.
      motivo = "sin_confirmar";
    } else if (paginando) {
      motivo = "pager";
    } else {
      motivo = "creciendo";
    }

    // Paginador pendiente: se paga con el MISMO golpe que usa __pageThrough
    // (unico sitio del fichero que teclea el paginador) y se sigue esperando.
    if (paginando && paginas < CONSOLA_OCUPADA_MAX_PAGINAS) {
      if (__pagarPagina(line, device)) paginas++;
    }

    if (Date.now() >= limite) break;
    res.esperas++;
    __busyWait(paso);
  }

  res.inactiva = inactiva;
  res.motivo = motivo;
  return res;
}

// La ultima linea del buffer es el "initial configuration dialog" de IOS con
// el prompt aun abierto. Tolera variantes: la frase completa, un simple
// "[yes/no]:" y el aviso "Please answer 'yes' or 'no'."
function __esDialogoInicial(ultima) {
  if (ultima.indexOf("please answer 'yes' or 'no'") !== -1) return true;
  if (ultima.indexOf("[yes/no]") !== -1) return true;
  if (ultima.indexOf("initial configuration dialog") !== -1) return /:\s*$/.test(ultima);
  return false;
}

// Cola del buffer donde se busca la marca del dialogo inicial (~300 chars,
// como el tail de `generator.ts` del MCP de referencia).
//
// POR QUE VIVE AQUI y no en el bloque de constantes del despertar mas abajo:
// esta es su UNICA fuente de uso (`__dialogoAbierto`, justo debajo) y se
// declara ANTES de ella a proposito. Todas las constantes de este fichero son
// `var` de nivel superior, asi que en un script clasico funcionan igualmente
// declaradas despues; pero depender del orden de evaluacion del fichero para
// que un valor exista cuando se lee es fragil (una reordenacion del ambito o
// del orden de carga daria `undefined` y el dialogo inicial dejaria de
// detectarse SIN NINGUN AVISO).
var DESPIERTA_COLA_DIALOGO = 300;

// ¿Esta el dialogo de configuracion inicial ABIERTO (listo para `no`)?
//
// Dos diferencias con la lectura de "solo la ultima linea":
//   1) la marca del dialogo se busca tambien en un TAIL de ~300 chars del
//      buffer, no solo en la ultima linea: PT cambia el formato del texto del
//      dialogo entre versiones y en algunas el marcador `[yes/no]` no queda en
//      la ultima linea. El MCP de referencia hace lo mismo (`generator.ts`,
//      tail de 300 chars) por robustez entre versiones.
//   2) aun apareciendo la marca, se EXIGE que la ultima linea sea la PREGUNTA
//      abierta (termina en `:`). Esta es la proteccion que NO se relaja: sin
//      ella, un dialogo ya contestado hace que `getOutput()` (acumulativo) siga
//      mostrando `[yes/no]` y el `no` de mas se cuela como hostname ->
//      `Translating "no"...domain server (255.255.255.255)`, el lookup DNS que
//      deja la consola muda ~30 s.
function __dialogoAbierto(bruto, ultima) {
  var u = ultima === undefined || ultima === null ? "" : String(ultima);
  // La ultima linea ES la pregunta: caso normal, sin mirar mas atras.
  if (__esDialogoInicial(u)) return true;

  var bajo = String(bruto === undefined || bruto === null ? "" : bruto).toLowerCase();
  var cola = bajo.length > DESPIERTA_COLA_DIALOGO
    ? bajo.substring(bajo.length - DESPIERTA_COLA_DIALOGO)
    : bajo;
  var marca =
    cola.indexOf("[yes/no]") !== -1 ||
    cola.indexOf("initial configuration dialog") !== -1 ||
    cola.indexOf("please answer 'yes' or 'no'") !== -1;
  if (!marca) return false;
  return /:\s*$/.test(u);
}

// Motivo por el que la consola de un equipo IOS no esta operativa, o "" si lo
// esta. Mira la salida recien obtenida (`salida`) y, si no la hay, la ultima
// linea del buffer: un `no` colado como hostname deja "Translating..." y el
// buffer sin prompt, y el dialogo inicial / "Press RETURN" se cuelan en la
// salida del comando.
// OJO: los motivos se devuelven como codigos cortos en espanol SIN las frases
// en ingles que la suite test-pt usa como marcador de "consola sucia": no
// queremos que nuestro propio diagnostico dispare un falso FALLO.
function __motivoConsolaBloqueada(line, salida) {
  var texto = String(salida || "").toLowerCase();
  if (texto.indexOf('translating "') !== -1) return "bloqueo_dns";
  if (texto.indexOf("initial configuration dialog") !== -1) return "dialogo_inicial";
  if (texto.indexOf("please answer 'yes' or 'no'") !== -1) return "dialogo_inicial";
  if (texto.indexOf("press return to get started") !== -1) return "press_return";
  if (!line || line.getOutput === undefined) return "";

  var buffer = String(line.getOutput() || "");
  var baja = buffer.toLowerCase();
  var ultima = __ultimaLinea(buffer);
  if (ultima.indexOf("initial configuration dialog") !== -1) return "dialogo_inicial";
  if (ultima.indexOf("press return to get started") !== -1) return "press_return";
  if (baja.indexOf('translating "') !== -1 && !/^[^#>]*[#>]\s*$/.test(ultima)) {
    return "bloqueo_dns";
  }
  return "";
}

// Responde a "Press RETURN to get started!" con una escalera de teclas
// (ver `__responderReturn`). Todos los intentos van protegidos y cada escalon se
// VERIFICA contra el buffer: si no escribe nada nuevo, se pasa al siguiente.
// Ultimo metodo de Enter que se intento y a quien se le atribuyo el desbloqueo
// (`""` = ninguno). Se expone en el payload para que el host y la suite vean
// QUE VIA funciona de verdad en PT 9, en vez de adivinarla.
var __ENTER_VIA_ULTIMA = "";

// Teclea un caracter suelto en la consola. `conNulo` decide si se pasa tambien
// el segundo argumento de `SpecialChar`: la API oficial declara
// `enterChar(byte, SpecialChar)` y PT valida la aridad, asi que se prueban las
// dos formas.
//
// MEDIDO en PT 9: `enterChar` es un NO-OP como via de tecleo (con 1 argumento y
// con los 2 oficiales). Se deja el metodo porque su ausencia haria que la escalera
// no pudiera ni intentarlo, pero NINGUN codigo depende ya de que funcione: lo
// que paga el paginador es `enterCommand(" ")` (ver `__pagarPagina`).
function __enterChar(line, code, conNulo) {
  if (!line || line.enterChar === undefined) return false;
  try {
    if (conNulo) line.enterChar(code, null);
    else line.enterChar(code);
  } catch (eChar) {
    return false;
  }
  return true;
}

function __responderReturn(line, device, espera) {
  // MEDIDO en PT 9 (script `scripts/pt-diag-estado-consola.ts`, 27 rondas de
  // sondeo): con `enterCommand("")` NO pasa nada (string vacio = no-op) y con
  // `enterCommand("\n")` tampoco se satisface el aviso de arranque: el aviso
  // seguia pendiente, el buffer NO tenia ni un solo prompt
  // (`ultimoPromptVisto: []`) y la ultima linea era un syslog
  // (`%LINEPROTO-5-UPDOWN`).
  //
  // HALLAZGO DE ESTA RONDA (el que obliga a corregir el comentario anterior):
  // `line.enterChar(codigo)` es un NO-OP en PT 9, tanto con 1 argumento
  // (`enterChar(32)`) como con los 2 que declara la API oficial
  // (`enterChar(32, null)`); lo que funciona para teclear una tecla suelta es
  // `enterCommand(<caracter>)` (`pagerVia:"enterCommandEspacio"` en una corrida
  // real de `show running-config`). Por eso `__pagarPagina` ya pone
  // `enterCommand` PRIMERO y deja `enterChar` al final.
  //
  // POR QUE EL ORDEN DE ESTA escalera NO se toca (a diferencia del paginador):
  // el aviso `Press RETURN to get started!` solo se ha medido con un router recien
  // creado y arrancando, NUNCA con `enterCommand("\n")` como via que funcione y
  // NUNCA con `enterCommand(" ")` al principio (un espacio al arrancar podria
  // colarse como respuesta del dialogo). Reordenar aqui seria adivinar. Se deja
  // la escalera como estaba (con `enterChar(13)`/`enterChar(10)` primero, que
  // son no-ops medidos pero no tienen coste) y `enterCommand` detras, con
  // `__ENTER_VIA_ULTIMA` exponiendo en el payload QUE via surte efecto: cuando
  // haya una medicion con el aviso de arranque pendiente, el payload dira si hay
  // que mover `enterCommand` de sitio.
  //
  // ACTUALIZACION: se ha ANADIDO `enterCommand(" ")` como ULTIMO peldano (no se
  // reordena nada). Razon: los cuatro peldanos previos se midieron con el equipo
  // AUN ARRANCANDO, donde la consola no acepta entrada y por eso ninguno surte
  // efecto; no es evidencia de que la tecla falle. Anadir al final es monotono
  // (no puede empeorar un estado donde hoy ya no funciona nada) y cubre el caso
  // de un equipo ya arrancado con el banner pendiente, que es el que de verdad
  // bloquea al agente. Ver el comentario del propio peldano.
  // Cada escalon se VERIFICA contra el buffer y se recuerda cual surtio efecto,
  // de modo que `__ENTER_VIA_ULTIMA` dice en el payload que metodo funciona.
  var escalones = [
    {
      via: "enterChar13",
      usar: function () {
        return __enterChar(line, 13, true) || __enterChar(line, 13, false);
      },
    },
    {
      via: "enterChar10",
      usar: function () {
        return __enterChar(line, 10, true) || __enterChar(line, 10, false);
      },
    },
    {
      via: "enterCommandNl",
      usar: function () {
        __sendCommand(line, device, "\n", "");
        return true;
      },
    },
    {
      via: "enterCommandVacio",
      usar: function () {
        __sendCommand(line, device, "", "");
        return true;
      },
    },
    // Ultimo recurso. `enterCommand(" ")` es el UNICO metodo medido como
    // efectivo para teclear una tecla suelta en PT 9 (`pagerVia:
    // "enterCommandEspacio"` en una corrida real de `show running-config`), y el
    // aviso `Press RETURN to get started!` se satisface con CUALQUIER tecla, no
    // solo con RETURN.
    //
    // MATIZ IMPORTANTE de la medicion previa: los cuatro peldanos anteriores se
    // midieron contra un router "recien creado y arrancando", y en ese estado NO
    // funciona ninguno porque el IOS todavia no ha terminado de cargar y la
    // consola no acepta entrada. Es decir, el fallo observado era de DISPONIBILIDAD
    // del equipo, no de la tecla. Por eso este peldaño se ANADE al final en vez de
    // reordenar la escalera: anadir no puede empeorar un caso en el que hoy ya no
    // funciona nada, y da una oportunidad real de limpiar el banner si el equipo ya
    // esta listo. `__ENTER_VIA_ULTIMA` dira si surtio efecto, que es la prueba que
    // faltaba.
    {
      via: "enterCommandEspacio",
      usar: function () {
        __sendCommand(line, device, " ", "");
        return true;
      },
    },
  ];

  for (var i = 0; i < escalones.length; i++) {
    var antes = String(__leerBuffer(line));
    var hecha = false;
    try {
      hecha = escalones[i].usar() === true;
    } catch (eEscalon) {
      hecha = false;
    }
    if (!hecha) continue;
    if (espera > 0) __busyWait(espera);
    __ENTER_VIA_ULTIMA = escalones[i].via;
    if (String(__leerBuffer(line)) !== antes) return true;
    // El metodo no movio el buffer: probamos el siguiente escalon, pero sin
    // insistir con los de `enterCommand`, que ya se han visto no-ops y solo
    // añadirian teclas vacias a la consola.
    if (escalones[i].via === "enterCommandNl") break;
  }
  return __ENTER_VIA_ULTIMA !== "";
}

// ---------------------------------------------------------------------------
// RESOLUTOR DE BLOQUEOS DE CONSOLA (`__resolverBloqueo` + `__aplicarBloqueo`)
//
// POR QUE EXISTE. MEDIDO en PT 9 con la suite `test-pt`: `show running-config`
// contra un 2911 recien creado NO termina nunca (45 sondeos y 55 s de
// presupuesto agotados) y `pollCommandResult` se queda en `en_curso` para
// siempre. La captura de la consola del router da la causa: el equipo termina
// de arrancar DESPUES de que pasara `__despertarConsola`, asi que su aviso de
// arranque se queda esperando, y el `show running-config` siguiente se consume
// como la tecla del RETURN. El comando nunca se ejecuta y por eso el evento
// `commandEnded` no salta nunca.
//
// `__despertarConsola` ya sabe contestar ese aviso (`__responderReturn`), pero no
// puede adelantarse a un arranque ASINCRONO: cuando se ejecuto el comando, el
// aviso todavia no estaba en el buffer. Y `pollCommandResult`, que es donde se
// pasa el 99 % del tiempo de espera, solo pagaba el `--More--`: nunca pulsaba
// Enter. Ahi es donde se resuelve.
//
// SEPARACION DETECCION / EJECUCION (y por que no es un unico helper). El sondeo
// necesita poder CONSULTAR la senal SIN actuar: el tope de acciones por
// pendiente se comprueba ANTES de teclear y, si el helper unico ya hubiera
// tecleado, al superarse el tope habria tecleado una vez de mas. Por eso
// `__resolverBloqueo` solo LEE el buffer y `__aplicarBloqueo` ejecuta UNA sola
// accion, reutilizando las piezas que ya habia: `__pagarPagina` (tecla espacio),
// `__responderReturn` (tecla del RETURN), `__sendCommand` (el `no` del dialogo y
// el Ctrl+^ del lookup DNS). La DETECCION reutiliza `__leerBuffer`,
// `__ultimaLinea` y `__dialogoAbierto`.
//
// PRIORIDAD (paginador > prompts). El `--More--` es la salida larga del comando
// EN CURSO, asi que se paga antes de mirar nada mas; detras, los tres prompts
// que se comen la linea recien tecleada.
//
// `consumioComando` va en la DECISION porque depende SOLO de la naturaleza de la
// tecla, no de si surtio efecto:
//
//   "espacio" -> false. Pagar una pagina NO invalida el comando: sigue siendo el
//                mismo, el corte por `before` sigue valiendo y su
//                `commandEnded` seguira saltando cuando termine.
//   "enter"   -> true.  Un RETURN, un "Press RETURN..." o un Ctrl+^ los consume
//   "no"      -> true.  un PROMPT pendiente, no el comando: la linea tecleada se
//   "escape"  -> true.  PIERDE (el caso medido es el aviso de arranque).
//
// En los tres ultimos el comando ya se ha perdido y su evento no llegara nunca.
// Quien debe decidir si lo reenvia es el HOST (que es quien sabe si el comando
// era reintentable), no esta funcion: por eso el sondeo EXPONE el estado
// (`estado:"reintentar"`) y no reintenta.
//
// `motivo` son CODIGOS cortos en espanol (`"espacio"`, `"enter"`, `"dialogo"`,
// `"dns"`), nunca el texto de consola en ingles: la suite `test-pt` marca FALLO
// por consola sucia y el propio diagnostico no puede dispararla.
// ---------------------------------------------------------------------------

// Cola del buffer donde se busca el aviso de arranque. NO basta con mirar la
// ULTIMA linea: medido en PT 9 el aviso queda seguido de mensajes de sistema
// (`%LINEPROTO-5-UPDOWN: ...`) que la consola sigue escribiendo mientras el
// RETURN sigue pendiente.
var BLOQUEO_COLA_PRESS_RETURN = 600;
// Espera tras teclear un desbloqueo (enter / `no` / Ctrl+^): corta, solo para
// que el buffer recoja lo escrito. La ronda siguiente es la que relee.
var BLOQUEO_ESPERA_MS = 120;
// Techo de tecleadas de desbloqueo (enter / `no` / Ctrl+^) POR PENDIENTE: un
// prompt que no se deje satisfacer no puede hacer loopear el sondeo. El paginador
// tiene su propio tope, el de siempre (`PAGINADOR_MAX_PAGINAS`).
var BLOQUEO_MAX_PROMPTS = 8;
// Linea que es un prompt de IOS ENTERO (`R1#`, `Router(config)#`, `R1>`). No
// admite espacios, asi que una linea de texto del sistema no puede hacer de
// prompt por accidente.
var RE_PROMPT_LINEA = /^[A-Za-z0-9_.\-/()[\]]{1,40}[>#]$/;

// ¿Sigue PENDIENTE el aviso "Press RETURN to get started!"?
//
// El aviso es una BARRERA: IOS no abre la CLI hasta que le llega una tecla, asi
// que TODO lo que se escribe DETRAS del aviso sigue estando "antes" del prompt.
// Es justo lo que se ve en la captura del usuario: el aviso, detras el
// `%LINEPROTO-5-UPDOWN: ...` y, solo tras el RETURN manual, el `R1>`. Por eso
// solo se da por resuelto cuando DETRAS de la marca aparece una linea que es un
// prompt de IOS.
function __pressReturnPendiente(bruto) {
  var bajo = String(bruto === undefined || bruto === null ? "" : bruto).toLowerCase();
  var pos = bajo.lastIndexOf("press return to get started");
  if (pos === -1) return false;
  var detras = bajo.substring(pos);
  if (detras.length > BLOQUEO_COLA_PRESS_RETURN) {
    detras = detras.substring(detras.length - BLOQUEO_COLA_PRESS_RETURN);
  }
  var lineas = detras.split("\n");
  for (var i = 0; i < lineas.length; i++) {
    var limpia = lineas[i].replace(/^\s+|\s+$/g, "");
    if (!limpia) continue;
    if (RE_PROMPT_LINEA.test(limpia)) return false;
  }
  return true;
}

// Que accion hay que tomar para el estado ACTUAL del buffer de la consola.
//
// NO ejecuta nada (es una LECTURA: ver la nota de separacion arriba). Devuelve
//   {accion: "espacio"|"enter"|"no"|"escape"|"", motivo: <codigo>, consumioComando}
// con `accion:""` cuando no hay ninguna senal que atender. Todo en try/catch: si
// una lectura falla se devuelve "sin accion", que es la respuesta segura (el
// sondeo sigue vivo y el host vuelve a preguntar).
function __resolverBloqueo(line) {
  var ninguna = { accion: "", motivo: "", consumioComando: false };
  if (!line || line.getOutput === undefined) return ninguna;
  var bruto;
  try {
    bruto = __leerBuffer(line);
  } catch (eLectura) {
    return ninguna;
  }
  if (!bruto) return ninguna;
  var bajo = String(bruto).toLowerCase();
  var ultima = __ultimaLinea(bruto);
  try {
    // 1) PAGINADOR `--More--`: la salida larga del comando en curso se ha
    //    quedado parada esperando una tecla. Se paga con ESPACIO y el comando
    //    sigue vivo, asi que no consume la linea tecleada.
    if (bajo.indexOf("--more--") !== -1) {
      return { accion: "espacio", motivo: "espacio", consumioComando: false };
    }
    // 2) AVISO DE ARRANQUE: hay que contestarle con una tecla (es el caso
    //    medido de este modulo).
    if (__pressReturnPendiente(bruto)) {
      return { accion: "enter", motivo: "enter", consumioComando: true };
    }
    // 3) DIALOGO INICIAL: se responde `no` con modo "" (es la respuesta al
    //    dialogo, no un comando IOS: nunca `enable`, que es lo que haria el
    //    lookup DNS documentado arriba).
    if (__dialogoAbierto(bruto, ultima)) {
      return { accion: "no", motivo: "dialogo", consumioComando: true };
    }
    // 4) LOOKUP DNS: un `no` suelto se colo como hostname e IOS lanzo
    //    `Translating "..."`, que deja la consola muda. Se corta con Ctrl+^
    //    ("\u001e"), igual que hace el despertar. Solo cuenta si la ultima linea
    //    NO es un prompt: `getOutput()` es acumulativo y el texto sigue ahi
    //    aunque el lookup ya se haya cortado (mismo criterio que
    //    `__despertarConsola`).
    if (bajo.indexOf('translating "') !== -1 && !/[#>]\s*$/.test(ultima)) {
      return { accion: "escape", motivo: "dns", consumioComando: true };
    }
  } catch (eDeteccion) {
    return ninguna;
  }
  return ninguna;
}

// Ejecuta la accion que decidio `__resolverBloqueo`, UNA sola vez, con las piezas
// que ya existian. Devuelve true si se pudo teclear.
function __aplicarBloqueo(line, device, bloqueo) {
  if (!line || !bloqueo || !bloqueo.accion) return false;
  try {
    if (bloqueo.accion === "espacio") return __pagarPagina(line, device);
    if (bloqueo.accion === "enter") {
      __responderReturn(line, device, BLOQUEO_ESPERA_MS);
      return true;
    }
    if (bloqueo.accion === "no") {
      __sendCommand(line, device, "no", "");
      __busyWait(BLOQUEO_ESPERA_MS);
      return true;
    }
    if (bloqueo.accion === "escape") {
      __sendCommand(line, device, "\u001e", "");
      __busyWait(BLOQUEO_ESPERA_MS);
      return true;
    }
  } catch (eAplicar) {
    // Sin `enterCommand` o con una API que lanza: se ignora y se sigue
    // esperando al evento (mismo criterio que el resto del fichero).
    return false;
  }
  return false;
}

// Anade un motivo al diagnostico acumulado del pendiente: "" -> "enter" ->
// "enter,espacio". Sin repetir: el diagnostico dice QUE se atendio, no cuantas
// veces, y asi el payload no crece ronda a ronda.
function __anadirMotivoBloqueo(p, motivo) {
  if (!p || !motivo) return false;
  var actual = __texto(p.bloqueoResuelto);
  if (!actual) {
    p.bloqueoResuelto = motivo;
    return true;
  }
  var partes = actual.split(",");
  for (var i = 0; i < partes.length; i++) {
    if (partes[i] === motivo) return false;
  }
  p.bloqueoResuelto = actual + "," + motivo;
  return true;
}

// ¿Alguno de los comandos del lote YA esta escrito en el buffer (su eco)?
//
// ES EL MISMO CRITERIO que usan los `results`: `__corte` con el `before`
// capturado antes de teclear el comando y el propio comando como ancla. Si el
// corte sale por `ancla`/`ancla_parcial` es que el eco se encontro; si sale por
// `prefijo` (el caso normal) se busca el eco dentro de la region que escribio el
// comando, que es justamente lo que devuelve ese corte.
function __comandoYaTecleado(pasos, full) {
  var texto = __texto(full);
  if (!texto) return false;
  for (var i = 0; i < pasos.length; i++) {
    var paso = pasos[i];
    if (!paso) continue;
    var ancla = __colapsar(paso.command);
    if (!ancla) continue;
    var corte = __corte(texto, paso.before, paso.command);
    if (corte.motivo === "ancla" || corte.motivo === "ancla_parcial") return true;
    if (corte.motivo === "prefijo" && __indiceAncla(__colapsar(corte.texto), ancla, 0) >= 0) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// PARAMETROS DEL DESPERTAR (a nivel de fichero para que la cabecera de cada
// helper los deje documentados en un solo sitio).
//
// El presupuesto del despertar sepidió de ~1 s (MAX_INTENTOS x el waitMs del
// caller) y era insuficiente: un 2911 recien creado en PT 9 sigue arrancando
// (`System Bootstrap` -> `Self decompressing the image` -> `#####` ->
// `Press RETURN to get started!` -> `Router>`) y el banner se colaba en el
// `output` del primer comando.
// ---------------------------------------------------------------------------

// FASE RAPIDA: las primeras pasadas, con la espera del caller. Es el caso
// normal (consola ya operativa) y se resuelve en la primera: no se penaliza.
var DESPIERTA_MAX_INTENTOS = 4;
// FASE EXTENDIDA: techo TOTAL del despertar. El MCP de referencia usa 60 s,
// aqui no se puede: `__busyWait` es una espera ACTIVA que CONGELA la UI de
// Packet Tracer, asi que 10 s es el techo razonable (el techo duro son 12 s).
var DESPIERTA_DEADLINE_MS = 10000;
// Suelo de la fase extendida: aunque la rapida haya agotado el presupuesto
// rapido, se da al menos este margen a que PT termine de arrancar.
var DESPIERTA_MIN_EXTENDIDO_MS = 2000;
// PROMPT ESTABLE: se exigen DOS sondeos consecutivos con el MISMO prompt.
// Un prompt puede aparecer a medio arrancar y luego desaparecer, asi que uno
// solo no basta (es lo que hace `cli-wait.ts:75-77` del MCP de referencia).
var DESPIERTA_SONDAS_ESTABLE = 2;
// NUDGE: ~6 sondeos (~3 s) sin prompt se manda UN `enterCommand("")` para
// empujar una CLI muda (`cli-wait.ts:82-89`). Solo una vez.
var DESPIERTA_SONDAS_NUDGE = 6;
// Techo de intentos de desbloqueo del lookup DNS con Ctrl+^ (probado en PT 9).
var DESPIERTA_MAX_DESBLOQUEOS = 2;
// (`DESPIERTA_COLA_DIALOGO` tambien es de este despertar, pero se declara MAS
// ARRIBA, junto a `__dialogoAbierto`, que es su unico consumidor: ver alli el
// "POR QUE VIVE AQUI".)
// Pausa entre sondeos de la fase extendida: ~500 ms como el MCP, acotada para
// que un `espera` grande (ping: 1200 ms) no se coma el techo de 10 s.
var DESPIERTA_PAUSA_MAX = 500;
var DESPIERTA_PAUSA_MIN = 200;
// Confirmacion de estabilidad del prompt: corta y fija, para NO pagar el
// `espera` del caller (que en ping son 1200 ms) en el caso normal.
var DESPIERTA_PAUSA_ESTABLE = 250;

// Despierta la consola de un equipo IOS recien creado.
//
// Por que hace falta: PT deja los routers/switches nuevos (addDevice) esperando
// en el "initial configuration dialog" [yes/no]. Mientras esa pregunta este
// pendiente, IOS toma CUALQUIER linea siguiente (ping, show running-config,
// hostname...) como respuesta y contesta "% Please answer 'yes' or 'no'", asi
// que todos los resultados saldrian vacios o con el texto del dialogo. El aviso
// "Press RETURN to get started" bloquea la consola de la misma manera.
//
// Por que NO se manda "no" a ciegas: si el equipo NO esta en el dialogo, IOS
// interpreta "no" como un hostname y lanza `Translating "no"...domain server
// (255.255.255.255)`, un lookup DNS bloqueante que deja la consola muda y todos
// los comandos siguientes con output vacio (reproducido en PT 9). Por eso el
// despertar es un BUCLE con verificacion: se relee el buffer tras cada accion,
// solo se responde "no" cuando el prompt del dialogo esta abierto y, si no se
// ha leido aun nada, se SONDEA con `show clock` (inofensivo) antes que enviar
// cualquier cosa. Si el lookup DNS ya esta en marcha se intenta cortar con
// Ctrl+^ ("\u001e", escape sequence por defecto de IOS, probada en PT 9) antes
// de rendirse (maximo 2 veces).
//
// La respuesta queda dentro del snapshot `before`/`antes` que captura el
// caller, de modo que el corte por prefijo de `__corte` la descarta y los
// `output` de results[i] salen limpios.
//
// Devuelve diagnostico, no un booleano:
//   {ok: boolean, motivo: string, despertado: boolean}
// `motivo` es un codigo corto (es-en-minusculas): "prompt_limpio",
// "dialogo_inicial", "press_return", "sondeo", "desbloqueo_dns",
// "bloqueo_dns_translating", "arranque_incompleto", "texto_no_reconocido",
// "sin_lectura", "sin_respuesta_return", "sin_linea_consola",
// "sin_enter_command", "no_ios". Ya no existe "tope_intentos": el bucle sale
// por prompt estable o por el deadline, nunca por agotar un numero de intentos.
function __despertarConsola(line, device, waitMs) {
  var MAX_INTENTOS = DESPIERTA_MAX_INTENTOS;
  // Techo de intentos de desbloqueo DNS (ver el paso 1 del bucle).
  var MAX_DESBLOQUEOS = DESPIERTA_MAX_DESBLOQUEOS;

  if (!line || line.getOutput === undefined) {
    return { ok: false, motivo: "sin_linea_consola", despertado: false };
  }
  // Solo IOS: en PC/Server/Laptop no hay dialogo inicial ni prompt IOS y NO se
  // les debe inyectar nada en su terminal (ni "no" ni un sondeo).
  if (__defaultMode(device) !== "enable") {
    return { ok: true, motivo: "no_ios", despertado: false };
  }

  var espera = typeof waitMs === "number" && waitMs > 0 ? waitMs : 0;
  var pausaRonda = espera > DESPIERTA_PAUSA_MAX
    ? DESPIERTA_PAUSA_MAX
    : (espera < DESPIERTA_PAUSA_MIN ? DESPIERTA_PAUSA_MIN : espera);
  var pausaEstable =
    espera > 0 ? (espera < DESPIERTA_PAUSA_ESTABLE ? espera : DESPIERTA_PAUSA_ESTABLE) : 0;

  var deadline = Date.now() + DESPIERTA_DEADLINE_MS;
  var despertado = false;
  var motivo = "prompt_limpio";
  var sondeoHecho = false;
  var desbloqueos = 0;
  // Prompt estable: DOS sondeos consecutivos con el MISMO prompt.
  var ultimoPrompt = "";
  var estable = 0;
  // Nudge: UN `enterCommand("")` de empujon como mucho.
  var nudgeHecho = false;
  var sondeosDesdeNudge = 0;
  // Ultimo bloqueo detectado, para el motivo de salida al agotar el deadline.
  var motivoVisto = "";
  var arrancando = false;
  var estado = "";

  for (var intento = 0; ; intento++) {
    var bruto = __leerBuffer(line);
    var cola = bruto.replace(/^\s+|\s+$/g, "");
    var ultima = __ultimaLinea(bruto);
    var bajo = bruto.toLowerCase();
    // Solo la cola final del buffer cuenta como "arrancando ahora": getOutput()
    // es acumulativo y el banner de arranque de hace un rato sigue ahi.
    arrancando = __arranqueEnCola(bruto, 1500);
    estado = __promptActual(line);

    // ---- FASE RAPIDA (caso normal) / FASE EXTENDIDA (arranque en curso) ----
    // La fase rapida son las MAX_INTENTOS primeras pasadas con la espera del
    // caller. Si al terminarla NO hay prompt y el buffer muestra señales de
    // arranque o de dialogo pendiente, se sigue con las MISMAS ramas hasta el
    // deadline (~10 s): no se teclea de mas, solo se espera a que PT termine
    // de escribir el arranque.
    if (intento >= MAX_INTENTOS) {
      if (intento === MAX_INTENTOS) {
        var suelo = Date.now() + DESPIERTA_MIN_EXTENDIDO_MS;
        if (suelo > deadline) deadline = suelo;
      }
      if (Date.now() >= deadline) {
        if (estado) return { ok: true, motivo: motivo, despertado: despertado };
        if (arrancando) {
          return { ok: false, motivo: "arranque_incompleto", despertado: despertado };
        }
        if (motivoVisto) return { ok: false, motivo: motivoVisto, despertado: despertado };
        return {
          ok: false,
          motivo: sondeoHecho ? "texto_no_reconocido" : "sin_lectura",
          despertado: despertado,
        };
      }
    }

    // 1) Prompt IOS (Router#, Router>, nombre#...): ya esta despierto, pero se
    //    exige que sea ESTABLE (dos sondeos con el mismo prompt): un prompt
    //    puede aparecer a medio arrancar y desaparecer al siguiente sondeo.
    if (estado) {
      if (estado === ultimoPrompt) {
        estable++;
        if (estable >= DESPIERTA_SONDAS_ESTABLE) {
          return { ok: true, motivo: motivo, despertado: despertado };
        }
      } else {
        estable = 1;
        ultimoPrompt = estado;
      }
      sondeosDesdeNudge = 0;
      // CASO NORMAL: una confirmacion corta (250 ms) y se sale. El deadline
      // se comprueba ANTES de esperar, asi que un prompt presente al llegar
      // aqui no se pierde aunque el tiempo se haya agotado.
      if (Date.now() >= deadline) {
        return { ok: true, motivo: motivo, despertado: despertado };
      }
      __busyWait(intento === 0 ? pausaEstable : pausaRonda);
      continue;
    }

    sondeosDesdeNudge++;

    // 2) Bloqueo DNS: un `no` suelto se colo como hostname y IOS lanzo
    //    `Translating "..."`, un lookup (255.255.255.255) que deja la consola
    //    muda. Antes de rendirse se intenta DESBLOQUEAR enviando Ctrl+^
    //    ("\u001e"): es la escape sequence por defecto de IOS y Packet Tracer
    //    la acepta (probado en PT 9: con la consola bloqueada,
    //    `["\u001e"]` devuelve status "ok" y el prompt de vuelta). Maximo
    //    MAX_DESBLOQUEOS intentos; si no basta, se devuelve el motivo para que
    //    el caller siga sin enviar comandos.
    //    OJO con que getOutput() es ACUMULATIVO: el texto `Translating "..."`
    //    sigue en el buffer aunque el lookup ya se haya cortado, asi que el
    //    bloqueo solo cuenta si la ultima linea NO es un prompt (mismo criterio
    //    que __motivoConsolaBloqueada).
    if (bajo.indexOf('translating "') !== -1 && !/[#>]\s*$/.test(ultima)) {
      if (desbloqueos >= MAX_DESBLOQUEOS) {
        return { ok: false, motivo: "bloqueo_dns_translating", despertado: despertado };
      }
      desbloqueos++;
      try {
        __sendCommand(line, device, "\u001e", "");
      } catch (eDns) {
        return { ok: false, motivo: "bloqueo_dns_translating", despertado: despertado };
      }
      if (espera > 0) __busyWait(espera);
      despertado = true;
      motivo = "desbloqueo_dns";
      motivoVisto = "bloqueo_dns_translating";
      continue;
    }

    // 3) Dialogo inicial abierto: se responde "no" con modo "" (es la
    //    respuesta al dialogo, no un comando IOS: sin `enable`).
    if (__dialogoAbierto(bruto, ultima)) {
      try {
        __sendCommand(line, device, "no", "");
      } catch (eDialogo) {
        return { ok: false, motivo: "sin_enter_command", despertado: despertado };
      }
      if (espera > 0) __busyWait(espera);
      despertado = true;
      motivo = "dialogo_inicial";
      motivoVisto = "dialogo_inicial";
      continue;
    }

    // 4) Pantalla de arranque: hay que contestarle tambien.
    if (ultima.indexOf("press return to get started") !== -1) {
      motivoVisto = "press_return";
      if (__responderReturn(line, device, espera)) {
        despertado = true;
        motivo = "press_return";
        continue;
      }
      // El Enter no movió el buffer: en fase rapida se rendia; en fase
      // extendida NO, porque el equipo puede estar escribiendo el resto del
      // arranque y responder un segundo mas tarde.
      if (intento < MAX_INTENTOS) {
        return { ok: false, motivo: "sin_respuesta_return", despertado: despertado };
      }
      __busyWait(pausaRonda);
      continue;
    }

    // 5) Buffer vacio: NO se manda nada a ciegas. Se sondea UNA vez con
    //    `show clock` (inofensivo en user y en enable); si hubiera dialogo, IOS
    //    lo consumira como respuesta y aparecera en la pasada siguiente.
    if (!cola) {
      if (!sondeoHecho) {
        sondeoHecho = true;
        try {
          __sendCommand(line, device, "show clock", "");
        } catch (eSondeo) {
          return { ok: false, motivo: "sin_enter_command", despertado: despertado };
        }
        if (espera > 0) __busyWait(espera);
        motivo = "sondeo";
        continue;
      }
      // Ya sondeado: solo se espera a que PT escriba algo (puede ser el banner
      // de arranque) hasta el deadline.
      __busyWait(pausaRonda);
      continue;
    }

    // 6) NUDGE: ~6 sondeos (~3 s) sin prompt y SIN marca de arranque se manda
    //    UN `enterCommand("")` para empujar una CLI muda (el "nudge" de
    //    `cli-wait.ts` del MCP de referencia). Con boot log NO se toca nada:
    //    PT esta escribiendo y cualquier linea se comeria como comando.
    if (!nudgeHecho && !arrancando && sondeosDesdeNudge >= DESPIERTA_SONDAS_NUDGE) {
      nudgeHecho = true;
      sondeosDesdeNudge = 0;
      try {
        __sendCommand(line, device, "", "");
      } catch (eNudge) {
        return { ok: false, motivo: "sin_enter_command", despertado: despertado };
      }
      __busyWait(pausaRonda);
      continue;
    }

    // 7) Hay texto de arranque ("#####", "Self decompressing...") o texto que
    //    no es ni dialogo ni prompt: NO se teclea nada mas, solo se espera a
    //    que PT termine de escribir. Asi el banner se gasta AQUI y no aparece
    //    dentro del `output` del primer comando.
    __busyWait(pausaRonda);
  }
}

// ---------------------------------------------------------------------------
// PREAMBULO PROFILACTICO (una vez por consola)
//
// Que atascos de PT 9 tapa (los cuatro que enumera el MCP de referencia en
// `examples/mcp-example/src/ipc/cli-prologue.ts:1-27`):
//   1) El wizard `[yes/no]` sin dismissar: lo tapa __despertarConsola.
//   2) Equipos enclavados en `>` (user): lo tapa __asegurarModo.
//   3) `--More--` parando la salida larga.
//   4) `Translating "<word>"...domain server` bloqueando el buffer ~30 s.
//
// Para (3) y (4):
//   * `terminal length 0` desactiva la paginacion `--More--`, que si no se
//     comeria los comandos siguientes (la salida larga se queda a medias).
//     CAVEAT documentado por el MCP: los SWITCHES de PT 9 NO implementan
//     `terminal length 0` (no dan error, simplemente no hace nada) y en los
//     que si, evita el paginador. Por eso es BEST EFFORT: se envia, no se
//     comprueba el resultado y no se falla si no surte efecto.
//   * `no ip domain-lookup` es EL IMPORTANTE: sin el, CUALQUIER palabra que IOS
//     interprete como hostname desconocido (tipicamente un `no` suelto)
//     lanza `Translating "no"...domain server (255.255.255.255)`, un lookup
//     DNS que bloquea el buffer ~30 s. Antes de este preambulo la extension no
//     emitia nunca ni `no ip domain-lookup` ni `terminal length 0`, y por eso
//     seguia cayendo en (4).
//
// CAMBIO DE COMPORTAMIENTO (documentado a proposito, como hace el MCP):
// `no ip domain-lookup` MODIFICA la configuracion del equipo (aparece en el
// running-config como `no ip domain-lookup`). Es el precio de que la consola no
// se quede muda 30 s por un hostname mal interpretado, y es lo que hace
// cualquier automatizacion seria de IOS. NO es configurable todavia; lo que se
// hace es exponerlo en el payload (`preambulo`) para que se vea que se aplico.
//
// Donde se emite: en `runDeviceCommands`, DESPUES de `__asegurarModo` (hace
// falta modo privilegiado) y ANTES del primer `before` de cada comando, de
// modo que su salida la descarta el corte por prefijo de `__corte` y NO aparece
// en results[i].
//
// "Una vez por consola": `getOutput()` es ACUMULATIVO, asi que si el comando ya
// esta en el buffer es que esta aplicado (el mismo truco que usa `__corte` al
// descartar por `before`) y
// no se re-emite. Asi un `configureIosDevice` de 6 comandos no hace 6 veces el
// trabajo extra. Devuelve diagnostico, no un booleano:
//   {emitido, comandos, pasos, motivo, cambioModo}
// `cambioModo` avisa de que el preambulo entro/salio de config (hacia falta
// para volver a asegurar el modo del lote): true si se tecleo `end` o
// `configure terminal`.
function __preambuloSeguro(device, linea, espera) {
  var res = { emitido: false, comandos: "", pasos: [], motivo: "no_emitido", cambioModo: false };

  // Solo IOS: en PC/Server/Laptop ni existe el CLI ni hacen falta estos
  // comandos, y no se les inyecta nada en su terminal.
  if (__defaultMode(device) !== "enable") {
    res.motivo = "no_ios";
    return res;
  }
  if (!linea || linea.getOutput === undefined) {
    res.motivo = "sin_linea_consola";
    return res;
  }

  var bruto = __leerBuffer(linea);
  var bajo = bruto.toLowerCase();
  var faltaTerminal = bajo.indexOf("terminal length 0") === -1;
  var faltaLookup = bajo.indexOf("no ip domain-lookup") === -1;
  if (!faltaTerminal && !faltaLookup) {
    res.motivo = "ya_aplicado";
    return res;
  }

  // Sin prompt legible NO se teclea nada: el despertar ya dejo su aviso en
  // payload.despertar y un preambulo a ciegas seria un hostname mas.
  var estado = __promptActual(linea);
  if (!estado) {
    res.motivo = "sin_prompt";
    return res;
  }

  var pausa = typeof espera === "number" && espera > 0 ? espera : 250;
  if (pausa > 1000) pausa = 1000;

  // Envia un paso del preambulo y espera a que IOS lo procese. `profilactico`
  // marca si el paso es uno de los dos comandos profilacticos (los que cuentan
  // como "preambulo aplicado"); los dos restantes (`configure terminal` y
  // `end`) son solo el sobre para entrar y salir de config.
  function enviar(paso, profilactico) {
    res.pasos.push(paso);
    if (paso === "end" || paso === "configure terminal") res.cambioModo = true;
    try {
      __sendCommand(linea, device, paso, "");
    } catch (ePaso) {
      res.motivo = "error_envio";
      return false;
    }
    if (pausa > 0) __busyWait(pausa);
    if (profilactico && res.motivo === "no_emitido") res.emitido = true;
    if (profilactico) {
      res.comandos = res.comandos ? res.comandos + "," + paso : paso;
    }
    return true;
  }

  // 1) A modo privilegiado: `terminal length 0` solo existe en exec y
  //    `no ip domain-lookup` es un comando de configuracion global.
  if (estado === "config") {
    if (!enviar("end", false)) return res;
    if (__promptActual(linea) !== "enable") {
      res.motivo = "transicion_sin_prompt";
      return res;
    }
  } else if (estado === "user") {
    if (!enviar("enable", false)) return res;
    if (__promptActual(linea) !== "enable") {
      res.motivo = "modo_no_confirmado";
      return res;
    }
  }

  // 2) `terminal length 0` (BEST EFFORT, ver cabecera).
  if (faltaTerminal) enviar("terminal length 0", true);

  // 3) `no ip domain-lookup`: el que evita el lookup DNS bloqueante.
  if (faltaLookup) {
    enviar("configure terminal", false);
    enviar("no ip domain-lookup", true);
    enviar("end", false);
  }

  if (res.emitido && res.motivo === "no_emitido") res.motivo = "aplicado";

  // RED DE SEGURIDAD: si alguna orden del preambulo dejo la consola sin prompt
  // (los switches de PT 9 no implementan `terminal length 0` y pueden dejar un
  // "% Invalid input" colgando, o un `^` de marcador), se fuerza un prompt con
  // un enter vacio. Sin prompt, el lote se ejecutaria en el modo viejo y TODOS
  // los comandos fallarian: preferimos un enter a perder la sesion.
  if (res.emitido && !__promptActual(linea)) {
    res.pasos.push("refresh_prompt");
    try {
      __sendCommand(linea, device, "", "");
    } catch (eRefresh) {
      res.motivo = "error_envio";
      return res;
    }
    if (pausa > 0) __busyWait(pausa);
    if (!__promptActual(linea)) res.motivo = "sin_prompt_final";
  }

  return res;
}

// Convierte un vector<string> de Qt (o un array normal) en array de strings.
function __vectorToArray(vec) {
  var out = [];
  if (!vec) return out;
  var len = -1;
  if (typeof vec.length === "number") {
    len = vec.length;
  } else if (typeof vec.size === "function") {
    try {
      len = vec.size();
    } catch (e) {
      len = -1;
    }
  }
  for (var i = 0; i >= 0 && i < len; i++) {
    var value;
    if (vec[i] !== undefined) value = vec[i];
    else if (typeof vec.at === "function") value = vec.at(i);
    else if (typeof vec.get === "function") value = vec.get(i);
    else value = null;
    if (value !== null && value !== undefined) out.push(String(value));
  }
  return out;
}

// ===========================================================================
//  UTILIDADES DE TOPOLOGIA / DIRECCIONAMIENTO
// ===========================================================================

// Dueno de un puerto: primero getOwnerDevice() (API real de Port),
// luego los metodos legacy por si el motor los expusiera.
function __portDeviceName(port) {
  if (!port) return "";
  try {
    if (typeof port.getOwnerDevice === "function") {
      var owner = port.getOwnerDevice();
      if (owner && typeof owner.getName === "function") {
        var ownerName = String(owner.getName());
        if (ownerName) return ownerName;
      }
    }
  } catch (e0) {
    // seguimos con los metodos legacy
  }
  try {
    if (port.getDevice !== undefined && port.getDevice()) return String(port.getDevice().getName());
  } catch (e1) {
    // seguimos con el siguiente metodo
  }
  try {
    if (port.getDeviceName !== undefined) {
      var direct = port.getDeviceName();
      if (direct) return String(direct);
    }
  } catch (e2) {
    // seguimos con el siguiente metodo
  }
  try {
    if (port.getParentDevice !== undefined && port.getParentDevice()) {
      return String(port.getParentDevice().getName());
    }
  } catch (e3) {
    // sin dueno conocido
  }
  return "";
}

// Lectura tolerante de la IP de un puerto.
// Devuelve null si la API no existe (no podemos concluir) o "" si no tiene IP.
function __portIp(port) {
  if (!port) return null;
  var names = ["getIpAddress", "getIPAddress", "getIp", "getIpv4Address", "getIPv4Address"];
  var found = false;
  for (var i = 0; i < names.length; i++) {
    try {
      if (port[names[i]] !== undefined) {
        found = true;
        var value = port[names[i]]();
        if (value !== undefined && value !== null) return String(value);
      }
    } catch (e) {
      // probamos el siguiente nombre de metodo
    }
  }
  return found ? "" : null;
}

// Lectura tolerante de la mascara de subred de un puerto (null si no hay API).
function __portMask(port) {
  if (!port) return null;
  var names = ["getSubnetMask", "getIpSubnetMask", "getMask", "getNetmask"];
  var found = false;
  for (var i = 0; i < names.length; i++) {
    try {
      if (port[names[i]] !== undefined) {
        found = true;
        var value = port[names[i]]();
        if (value !== undefined && value !== null) return String(value);
      }
    } catch (e) {
      // probamos el siguiente nombre de metodo
    }
  }
  return found ? "" : null;
}

// "a.b.c.d" -> numero (null si no es una IP valida).
function __ipToLong(ip) {
  var parts = String(ip || "").split(".");
  if (parts.length !== 4) return null;
  var value = 0;
  for (var i = 0; i < 4; i++) {
    var piece = String(parts[i]);
    if (piece.indexOf(".") !== -1) return null;
    var octet = Number(piece);
    if (isNaN(octet) || octet < 0 || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

// true/false = misma subred o no; null = no se pudo determinar.
function __sameSubnet(ip1, mask1, ip2, mask2) {
  var a = __ipToLong(ip1);
  var b = __ipToLong(ip2);
  var m1 = __ipToLong(mask1);
  var m2 = __ipToLong(mask2);
  if (a === null || b === null || m1 === null || m2 === null) return null;
  if (m1 !== m2) return null;
  var size = Math.pow(2, 32) - m1 + 1;
  if (size <= 0) return null;
  return Math.floor(a / size) === Math.floor(b / size);
}

// ¿Es un host (PC, server, laptop, tablet, telefono, etc.)?
function __isHostType(type) {
  if (type === 8 || type === 9 || type === 10) return true;
  if (type >= 18 && type <= 27) return true;
  if (type === 40) return true;
  return false;
}

// ===========================================================================
//  DIRECCIONAMIENTO (para getNetwork)
//
//  El backend lee el snapshot de getNetwork con `direccionamientoDe`
//  (Tool.ts) y busca, por equipo: `ip`/`ipAddress`/`ipaddress`/`address`,
//  `subnetMask`/`mask`/`netmask`, `defaultGateway`/`gateway`, el array `ips`
//  y esos MISMOS campos dentro de `ipConfiguration`, `ipConfig` e
//  `interfaces[i]`. Aqui solo se ANADEN esos campos (nada existente cambia de
//  forma) y SOLO cuando hay un valor util: los consumidores ignoran lo que no
//  reconozcan.
//
//  Fuentes, por orden: API de Port/Device (metodos o propiedades), objetos
//  `ipConfiguration`/`ipConfig` del equipo y, si la API no da NINGUNA
//  direccion, el serializeToXml de PT (<PORT><IP>...</IP><SUBNET>...
//  </SUBNET><PORT_GATEWAY>...</PORT_GATEWAY>). Nunca se inventa un valor.
// ===========================================================================

// Nombres de campo/metodo que usan PT y el backend para cada dato.
var DIR_IP = [
  "getIpAddress", "getIPAddress", "getIp", "getIpv4Address", "getIPv4Address",
  "ipAddress", "ipaddress", "ip", "address",
];
var DIR_MASCARA = [
  "getSubnetMask", "getIpSubnetMask", "getMask", "getNetmask",
  "subnetMask", "mask", "netmask",
];
var DIR_GATEWAY = [
  "getDefaultGateway", "getGateway", "getDefaultGatewayIp",
  "defaultGateway", "gateway",
];
var DIR_DHCP = ["getDhcpFlag", "isDhcpEnabled", "getDhcp", "dhcpEnabled", "dhcp"];

// Valor util de una propiedad O metodo de un objeto de PT ("getIp()" o "ip").
// "" si no existe o si lanza. Un objeto Qt que no sea un primitivo se intenta
// convertir igual (a veces es un QString envuelto) y se descarta si sale algo
// con forma de "[object ...]" o demasiado largo: nunca se cuela basura en el
// payload.
function __valorDir(obj, nombres) {
  if (!obj) return "";
  for (var i = 0; i < nombres.length; i++) {
    try {
      var v = obj[nombres[i]];
      if (typeof v === "function") v = obj[nombres[i]]();
      if (v === undefined || v === null) continue;
      var t = String(v).replace(/^\s+|\s+$/g, "");
      if (!t) continue;
      if (t.length > 64 || t.indexOf("[object") !== -1) continue;
      return t;
    } catch (e) {
      // probamos el siguiente nombre
    }
  }
  return "";
}

// Direccion IPv4 util: valida y distinta de 0.0.0.0 (que en PT significa
// "sin direccion"). Devuelve el valor o "".
function __dirUtil(valor) {
  if (__ipToLong(valor) === null) return "";
  var t = String(valor).replace(/^\s+|\s+$/g, "");
  return t === "0.0.0.0" ? "" : t;
}

// Bandera DHCP (true/false) de un objeto de PT; null si no la expone.
function __dhcpDe(obj) {
  if (!obj) return null;
  for (var i = 0; i < DIR_DHCP.length; i++) {
    try {
      var v = obj[DIR_DHCP[i]];
      if (typeof v === "function") v = obj[DIR_DHCP[i]]();
      if (v === undefined || v === null) continue;
      if (typeof v === "boolean") return v;
      var t = String(v).toLowerCase();
      if (t === "true" || t === "1") return true;
      if (t === "false" || t === "0") return false;
    } catch (e) {
      // probamos el siguiente nombre
    }
  }
  return null;
}

// Valor de <ETIQUETA>texto</ETIQUETA> dentro de un trozo de xml de PT
// (null si no aparece; "" si aparece vacia, p. ej. la forma <ETIQUETA/>).
function __etiquetaXml(texto, etiqueta) {
  var t = texto === undefined || texto === null ? "" : String(texto);
  if (!t) return null;
  var m = new RegExp("<" + etiqueta + ">([\\s\\S]*?)</" + etiqueta + ">", "i").exec(t);
  if (m) return __desescaparXml(m[1]).replace(/^\s+|\s+$/g, "");
  if (new RegExp("<" + etiqueta + "\\s*/>", "i").test(t)) return "";
  return null;
}

// Direccionamiento por puerto del serializeToXml de PT, para cuando la API de
// Port no expone la direccion. Recorre los bloques <PORT> ... </PORT> (el
// contenedor <PORTS> no casilla: hace falta ">" o espacio justo tras "PORT")
// y lee sus <IP>/<SUBNET>/<PORT_GATEWAY> con sus aliases habituales.
//   {porNombre: {nombrePuerto: {ip, mascara, gateway}}, sueltos: [...]}
// `sueltos` recoge los bloques sin nombre reconocible; los bloques sin IP
// valida se ignoran (nunca se inventa direccion).
function __dirDesdeXmlPuertos(xml) {
  var res = { porNombre: {}, sueltos: [] };
  var texto = xml === undefined || xml === null ? "" : String(xml);
  if (!texto) return res;

  var re = /<PORT(\s[^>]*)?>([\s\S]*?)<\/PORT>/gi;
  var m = re.exec(texto);
  while (m) {
    var bloque = m[2];
    var ip = __dirUtil(__etiquetaXml(bloque, "IP") || __etiquetaXml(bloque, "IPADDRESS"));
    if (ip) {
      var mascara = __dirUtil(
        __etiquetaXml(bloque, "SUBNET") ||
          __etiquetaXml(bloque, "SUBNETMASK") ||
          __etiquetaXml(bloque, "NETMASK")
      );
      var gateway = __dirUtil(
        __etiquetaXml(bloque, "PORT_GATEWAY") ||
          __etiquetaXml(bloque, "DEFAULTGATEWAY") ||
          __etiquetaXml(bloque, "GATEWAY")
      );
      var dato = { ip: ip, mascara: mascara, gateway: gateway };
      var nombre =
        __etiquetaXml(bloque, "NAME") || __etiquetaXml(bloque, "PORTNAME") || "";
      if (nombre) res.porNombre[nombre] = dato;
      else res.sueltos.push(dato);
    }
    m = re.exec(texto);
  }
  return res;
}

// ===========================================================================
//  UTILIDADES DE BYTES / BASE64 (no hay btoa ni Buffer en el Script Engine)
// ===========================================================================

function __byteLength(bytes) {
  if (!bytes) return 0;
  if (typeof bytes.length === "number") return bytes.length;
  if (typeof bytes.size === "function") {
    try {
      return bytes.size();
    } catch (e) {
      return 0;
    }
  }
  return 0;
}

function __byteAt(bytes, index) {
  var value;
  try {
    if (bytes[index] !== undefined) value = bytes[index];
    else if (typeof bytes.at === "function") value = bytes.at(index);
    else if (typeof bytes.get === "function") value = bytes.get(index);
    else value = 0;
  } catch (e) {
    value = 0;
  }
  value = Number(value);
  if (isNaN(value)) value = 0;
  return value & 0xff;
}

// Codificador base64 escrito a mano (bytes -> string).
function __bytesToBase64(bytes, len) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  var n = len || 0;
  for (var i = 0; i < n; i += 3) {
    var b0 = __byteAt(bytes, i);
    var b1 = i + 1 < n ? __byteAt(bytes, i + 1) : 0;
    var b2 = i + 2 < n ? __byteAt(bytes, i + 2) : 0;
    out += alphabet.charAt(b0 >> 2);
    out += alphabet.charAt(((b0 & 0x03) << 4) | (b1 >> 4));
    out += i + 1 < n ? alphabet.charAt(((b1 & 0x0f) << 2) | (b2 >> 6)) : "=";
    out += i + 2 < n ? alphabet.charAt(b2 & 0x3f) : "=";
  }
  return out;
}

// Decodificador base64 escrito a mano (string -> array de bytes 0..255).
function __base64ToBytes(text) {
  var alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var clean = String(text || "").replace(/\s+/g, "").replace(/[^A-Za-z0-9+/=]/g, "");
  var out = [];
  var i = 0;
  while (i < clean.length) {
    var c1 = alphabet.indexOf(clean.charAt(i++));
    var c2 = alphabet.indexOf(clean.charAt(i++));
    var ch3 = clean.charAt(i++);
    var ch4 = clean.charAt(i++);
    var c3 = ch3 === "=" ? -1 : alphabet.indexOf(ch3);
    var c4 = ch4 === "=" ? -1 : alphabet.indexOf(ch4);
    if (c1 < 0 || c2 < 0) break;
    out.push(((c1 << 2) | (c2 >> 4)) & 0xff);
    if (c3 >= 0) out.push((((c2 << 4) | (c3 >> 2)) & 0xff));
    if (c4 >= 0) out.push(((((c3 < 0 ? 0 : c3) << 6) | c4) & 0xff));
  }
  return out;
}

addDevice = function (deviceName, deviceModel, x, y) {
  try {
    var deviceType = allDeviceTypes[deviceModel];

    if (deviceType === undefined) {
      return {
        success: false,
        error: `Unknown device model: ${deviceModel}`,
      };
    }

    var originalDeviceName = ipc
      .appWindow()
      .getActiveWorkspace()
      .getLogicalWorkspace()
      .addDevice(deviceType, deviceModel, x, y);

    if (!originalDeviceName) {
      return {
        success: false,
        error: `Failed to add device ${deviceName} (${deviceModel})`,
      };
    }

    var device = ipc.network().getDevice(originalDeviceName);
    device.setName(deviceName);

    if (deviceType <= 1 || deviceType == 16) {
      device.skipBoot();
    }

    return {
      success: true,
      message: `Device ${deviceName} added successfully`,
    };
  } catch (error) {
    return fail("Error adding device", error);
  }
};

addModule = function (deviceName, slot, model) {
  try {
    var device = ipc.network().getDevice(deviceName);

    if (!device) {
      return {
        success: false,
        error: `Device ${deviceName} not found`,
      };
    }

    var moduleType = allModuleTypes[model];

    if (moduleType === undefined) {
      return {
        success: false,
        error: `Unknown module model: ${model}`,
      };
    }

    var powerState = device.getPower();
    device.setPower(false);

    var result = device.addModule(slot, moduleType, model);

    if (powerState) {
      device.setPower(true);
      device.skipBoot();
    }

    if (result != true) {
      return {
        success: false,
        error: `Failed to add module ${model} to slot ${slot} on ${deviceName}`,
      };
    }

    return {
      success: true,
      message: `Module ${model} added to ${deviceName} slot ${slot}`,
    };
  } catch (error) {
    return fail("Error adding module", error);
  }
};

addLink = function (
  device1Name,
  device1Interface,
  device2Name,
  device2Interface,
  linkType
) {
  try {
    var linkTypeValue = allLinkTypes[linkType];

    if (linkTypeValue === undefined) {
      return {
        success: false,
        error: `Unknown link type: ${linkType}`,
      };
    }

    var result = ipc
      .appWindow()
      .getActiveWorkspace()
      .getLogicalWorkspace()
      .createLink(
        device1Name,
        device1Interface,
        device2Name,
        device2Interface,
        linkTypeValue
      );

    if (result != true) {
      return {
        success: false,
        error: `Failed to create link between ${device1Name}:${device1Interface} and ${device2Name}:${device2Interface}`,
      };
    }

    return {
      success: true,
      message: `Link created between ${device1Name} and ${device2Name}`,
    };
  } catch (error) {
    return fail("Error creating link", error);
  }
};

configurePcIp = function (
  deviceName,
  dhcpEnabled,
  ipaddress,
  subnetMask,
  defaultGateway,
  dnsServer
) {
  try {
    var device = ipc.network().getDevice(deviceName);

    if (!device) {
      return {
        success: false,
        error: `Device ${deviceName} not found`,
      };
    }

    var port = device.getPort("FastEthernet0");

    if (!port) {
      return {
        success: false,
        error: `FastEthernet0 port not found on ${deviceName}`,
      };
    }

    if (dhcpEnabled !== undefined && dhcpEnabled !== null) {
      device.setDhcpFlag(dhcpEnabled);
    }
    if (ipaddress && subnetMask) port.setIpSubnetMask(ipaddress, subnetMask);
    if (defaultGateway) port.setDefaultGateway(defaultGateway);
    if (dnsServer) port.setDnsServerIp(dnsServer);

    return {
      success: true,
      message: `IP configuration applied to ${deviceName}`,
    };
  } catch (error) {
    return fail("Error configuring PC IP", error);
  }
};

// ---------------------------------------------------------------------------
// MODOS IOS DE VERDAD (transiciones tecleadas a mano)
//
// Por que hace falta: Packet Tracer IGNORA el 2.º argumento de
// enterCommand(cmd, mode) (comprobado en PT 9): `mode:"global"` + `hostname X`
// llega a IOS en MODO USUARIO y sale con "% Invalid input detected at '^'
// marker", y `mode:"enable"` tampoco saca de `Router>` a `Router#`. El modo hay
// que lograrlo TECLEANDO las transiciones (enable / configure terminal / end /
// disable) ANTES de ejecutar el lote de comandos.
//
// Ese tecleo se hace FUERA del bucle de runDeviceCommands, justo despues del
// despertar: su salida queda antes del primer `before`, asi que el corte por
// prefijo de `__corte`
// la descarta y NO aparece en results[i] (el mismo truco que ya usa
// __despertarConsola).
// ---------------------------------------------------------------------------

// Secuencia minima de transiciones para ir de `actual` a `objetivo`
// ("user" | "enable" | "config" | "" segun __promptActual / modo pedido).
function __secuenciaModo(actual, objetivo) {
  if (!actual || !objetivo || actual === objetivo) return [];
  if (objetivo === "global") {
    if (actual === "user") return ["enable", "configure terminal"];
    if (actual === "enable") return ["configure terminal"];
    return []; // ya en config
  }
  if (objetivo === "enable") {
    if (actual === "user") return ["enable"];
    if (actual === "config") return ["end"];
    return [];
  }
  if (objetivo === "user") {
    if (actual === "config") return ["end", "disable"];
    if (actual === "enable") return ["disable"];
    return [];
  }
  // Objetivo vacio (en IOS nunca llega asi: runDeviceCommands lo rellena con
  // __defaultMode, pero el helper se queda sin objetivo por robustez): solo
  // hace falta salir del modo configuracion.
  if (actual === "config") return ["end"];
  return [];
}

// Estado IOS que resultaria de teclear `cmd` estando en `estado`. Un comando
// que IOS rechazaria en ese estado (p. ej. `configure terminal` en modo
// usuario) NO cambia el estado: asi nunca se "absorbe" un paso que no se podria
// dar. `write memory` / `do ...` / cualquier `show` no cambian de modo.
function __estadoTras(estado, cmd) {
  var t = String(cmd === undefined || cmd === null ? "" : cmd)
    .replace(/^\s+|\s+$/g, "")
    .toLowerCase();
  if (t === "enable") return estado === "user" ? "enable" : estado;
  if (
    t === "configure terminal" ||
    t === "conf t" ||
    t === "configure t" ||
    t === "conf terminal"
  ) {
    return estado === "enable" ? "config" : estado;
  }
  if (t === "end") return estado === "config" ? "enable" : estado;
  if (t === "exit") {
    if (estado === "config") return "enable";
    if (estado === "enable") return "user";
    return estado;
  }
  if (t === "disable") return estado === "enable" ? "user" : estado;
  return estado;
}

// Que trozo de la secuencia hay que emitir ANTES del lote: el prefijo mas
// corto tal que, al ejecutar despues el PRIMER comando del lote, la consola
// acabe en el modo pedido. Evita duplicar transiciones que el propio lote ya
// trae (`enable` x2, `configure terminal` sobre `configure terminal`).
function __prefijoTransicion(actual, objetivo, secuencia, primero) {
  for (var k = 0; k <= secuencia.length; k++) {
    var estado = actual;
    for (var j = 0; j < k; j++) estado = __estadoTras(estado, secuencia[j]);
    if (__estadoTras(estado, primero) === objetivo) return secuencia.slice(0, k);
  }
  return secuencia.slice();
}

// Espera activa y acotada a que la consola muestre el prompt `esperado`.
// Devuelve el prompt leido: puede seguir siendo otro si PT no llego a
// reaccionar (el caller no aborta por eso) o "" si dejo de haber prompt
// (p. ej. `Password:` de un enable secret: ahi SI hay que parar de teclear).
function __esperarPrompt(line, esperado, pausa) {
  if (!esperado) return __promptActual(line);
  var limite = Date.now() + pausa;
  var actual = __promptActual(line);
  while (actual !== esperado) {
    if (!actual) return "";
    if (Date.now() >= limite) return actual;
    __busyWait(100);
    actual = __promptActual(line);
  }
  return actual;
}

// Deja la consola de un equipo IOS en `modoObjetivo` ANTES de que se ejecute
// el lote `comandos`. `modoObjetivo` es el `mode` de runDeviceCommands
// ("user" | "enable" | "global", en IOS nunca vacio).
//
// Devuelve diagnostico para `payload.modo`:
//   {antes, despues, emitidos, avisos}
// `antes`/`despues` son estados ("user"/"enable"/"config"/""), NO el prompt
// crudo (nada de texto de consola en ingles en el payload: la suite test-pt
// marcaria FALLO por "consola sucia"). `avisos` viene vacio cuando todo salio
// segun lo previsto: en ese caso runDeviceCommands NO anade `payload.modo`.
//   - prompt_no_legible      -> sin prompt no se teclea nada (el despertar ya
//                               dejo su diagnostico en payload.despertar)
//   - error_transicion       -> enterCommand lanzo al teclear una transicion
//   - transicion_sin_prompt  -> tras un paso desaparecio el prompt: se corta
//   - modo_no_confirmado     -> el prompt no acabo en el estado pedido (se
//                               CONTINUA igualmente: IOS a veces no cambia de
//                               prompt en lotes y el lote puede valerse solo)
function __asegurarModo(line, device, modoObjetivo, espera, comandos) {
  var res = { antes: "", despues: "", emitidos: [], avisos: [] };

  // Solo IOS: los equipos sin CLI IOS (PC/Server/Laptop) no entienden
  // `enable`/`configure terminal` y NO se les inyecta nada en su terminal.
  if (__defaultMode(device) !== "enable") return res;

  // Sin consola legible no se teclea nada (el despertar ya dejo su
  // diagnostico en payload.despertar: no se duplica el aviso aqui).
  if (!line || line.getOutput === undefined) return res;

  // Sin lote no hay nada que asegurar (un runDeviceCommands vacio no debe
  // cambiar el modo de la consola como efecto secundario).
  var primero = null;
  if (comandos && comandos.length) {
    for (var c = 0; c < comandos.length; c++) {
      var candidato =
        comandos[c] === undefined || comandos[c] === null ? "" : String(comandos[c]);
      if (candidato.replace(/^\s+|\s+$/g, "")) {
        primero = candidato;
        break;
      }
    }
  }
  if (!primero) return res;

  res.antes = __promptActual(line);
  if (!res.antes) {
    res.avisos.push("prompt_no_legible");
    return res;
  }

  var secuencia = __secuenciaModo(res.antes, modoObjetivo);
  if (!secuencia.length) return res;

  var porEmitir = __prefijoTransicion(res.antes, modoObjetivo, secuencia, primero);

  // Suelo de espera: aunque el caller pida waitMs 0, una transicion necesita
  // tiempo para que IOS cambie de prompt (si no, el lote sale en el modo viejo).
  // Techo tambien: quien pide esperas largas (ping) no debe pagarlas en cada
  // transicion, con 1 s basta para que IOS reaccione.
  var pausa = espera > 0 ? espera : 250;
  if (pausa > 1000) pausa = 1000;

  var estado = res.antes;
  for (var s = 0; s < porEmitir.length; s++) {
    var paso = porEmitir[s];
    var objetivoPaso = __estadoTras(estado, paso);
    try {
      __sendCommand(line, device, paso, "");
    } catch (eTrans) {
      res.avisos.push("error_transicion");
      break;
    }
    __busyWait(pausa);
    res.emitidos.push(paso);
    estado = objetivoPaso;
    if (!__esperarPrompt(line, objetivoPaso, pausa)) {
      // Sin prompt (Password:, bloqueo...): NO se sigue tecleando.
      res.avisos.push("transicion_sin_prompt");
      break;
    }
  }

  res.despues = __promptActual(line);
  var esperado =
    modoObjetivo === "global"
      ? "config"
      : modoObjetivo === "user"
        ? "user"
        : modoObjetivo === "enable"
          ? "enable"
          : "";
  if (res.emitidos.length && esperado && res.despues !== esperado) {
    res.avisos.push("modo_no_confirmado");
  }
  return res;
}

// ---------------------------------------------------------------------------
// Motor de comandos: ejecuta una lista de comandos sobre la consola del
// dispositivo capturando la salida real (getOutput es acumulativo).
// ---------------------------------------------------------------------------
runDeviceCommands = function (deviceName, commands, options) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: `Device ${deviceName} not found` };
    }

    // Tolerancia: un string se parte por lineas; el contrato pide array.
    if (typeof commands === "string") commands = commands.split("\n");
    if (!Array.isArray(commands)) {
      return { success: false, error: "commands debe ser un array de strings" };
    }

    var opts = options || {};
    var waitMs = typeof opts.waitMs === "number" && opts.waitMs >= 0 ? opts.waitMs : 250;
    var maxChars = typeof opts.maxChars === "number" && opts.maxChars > 0 ? opts.maxChars : 8000;

    // Modos validos SOLO: "", "user", "enable", "global"
    var mode = typeof opts.mode === "string" ? opts.mode : "";
    if (mode !== "" && mode !== "user" && mode !== "enable" && mode !== "global") mode = "";
    if (!mode) mode = __defaultMode(device);

    var deviceType = null;
    try {
      deviceType = device.getType();
    } catch (eType) {
      deviceType = null;
    }

    var line = __resolveLine(device);
    var canRead = !!(line && line.getOutput !== undefined);
    var results = [];
    var rootWarning = canRead ? null : "console_output_unavailable";

    // Despertamos la consola (initial configuration dialog / Press RETURN) justo
    // antes del bucle: PT crea los routers esperando [yes/no] y, sin esto, el
    // dialogo se traga TODOS los comandos. La respuesta queda antes del primer
    // `before`, asi que el corte por prefijo de `__corte` la descarta y no
    // contamina results[i].
    // El despertar es un bucle con verificacion (nunca manda `no` a ciegas) y
    // devuelve diagnostico: si sale mal se anade al payload para que se vea.
    var despertar = __despertarConsola(line, device, waitMs);

    // Consola bloqueada por un lookup DNS (un `no` colado como hostname):
    // mandar comandos en ese estado solo empeora el bloqueo, asi que no se
    // envia NADA y cada resultado sale con status "unknown" (nunca "ok") junto
    // al diagnostico `despertar` en la raiz del payload.
    var consolaBloqueada =
      !!despertar && despertar.ok === false && despertar.motivo === "bloqueo_dns_translating";

    // Aseguramos el modo ANTES del bucle (al lado del despertar, que ya se
    // ocupo de dialogo/Press RETURN/bloqueo DNS): las transiciones tecleadas
    // aqui salen antes del primer `before`, asi que el corte por prefijo de
    // `__corte` las
    // descarta y results[i] se queda solo con la salida del lote. Si la
    // consola esta bloqueada no se toca NADA.
    var ajusteModo = null;
    var preambulo = null;
    if (!consolaBloqueada) {
      ajusteModo = __asegurarModo(line, device, mode, waitMs, commands);

      // Preambulo profilactico (`terminal length 0` + `no ip domain-lookup`).
      // Va DESPUES de __asegurarModo porque necesita modo privilegiado, y
      // ANTES del primer `before` para que el corte por prefijo de `__corte`
      // descarte su salida.
      // Solo se emite si la consola NO esta bloqueada (misma guarda que arriba).
      preambulo = __preambuloSeguro(device, line, waitMs);
      // El preambulo entra y sale de config para emitir `no ip domain-lookup`:
      // si el lote esperaba otro modo hay que volver a asegurarlo (para
      // `mode:"global"` eso es un `configure terminal` mas; para "enable"/"user"
      // la re-aseguracion no emite nada y no cuesta espera).
      if (preambulo && preambulo.emitido && preambulo.cambioModo) {
        var reasegurado = __asegurarModo(line, device, mode, waitMs, commands);
        if (ajusteModo) {
          for (var a = 0; a < reasegurado.avisos.length; a++) {
            if (ajusteModo.avisos.indexOf(reasegurado.avisos[a]) === -1) {
              ajusteModo.avisos.push(reasegurado.avisos[a]);
            }
          }
        } else {
          ajusteModo = reasegurado;
        }
      }
    }

    var arranquePendiente = 0;
    // Diagnostico de captura: comandos cuyo corte fue DEGRADADO (el buffer de PT
    // habia perdido la cabeza y tampoco aparecia el eco del comando) y comandos
    // que se teclearon con la consola todavia ocupada.
    var cortesDegradados = 0;
    var consolaOcupada = 0;
    // La espera por consola inactiva es un asunto de la CLI de IOS: en
    // PC/Server/Laptop el prompt no es de IOS y la espera solo costaria tiempo.
    var esIos = __defaultMode(device) === "enable";

    for (var i = 0; i < commands.length; i++) {
      var cmd = commands[i] === undefined || commands[i] === null ? "" : String(commands[i]);
      if (!cmd.trim()) continue;

      if (consolaBloqueada) {
        results.push({ command: cmd, status: "unknown", output: "" });
        continue;
      }

      // ANTES de teclear: no se manda un comando con la consola ocupada (PT
      // pierde el primer caracter y sale "% Invalid input detected"). Con la
      // consola ya quieta esto no cuesta nada (una lectura, sin espera). Si
      // tras el tope sigue ocupada, se manda igualmente y se avisa en el
      // payload: bloquear al agente aqui seria peor que el comando mal
      // tecleado.
      if (canRead && esIos) {
        var libre = __esperarConsolaInactiva(
          line,
          CONSOLA_OCUPADA_TOPE_MS,
          1,
          CONSOLA_OCUPADA_PASO_MS,
          device
        );
        if (!libre.inactiva) consolaOcupada++;
      }

      var before = canRead ? __leerBuffer(line) : "";
      var statusRaw;
      var execError = null;
      try {
        statusRaw = __sendCommand(line, device, cmd, mode);
      } catch (eCmd) {
        execError = (eCmd && (eCmd.message || String(eCmd))) || "error desconocido";
      }

      if (waitMs > 0) __busyWait(waitMs);

      var output = "";
      var corte = { texto: "", limpio: true, motivo: "prefijo" };
      if (canRead) {
        // La salida se captura cuando PT ha TERMINADO de escribirla (dos
        // lecturas con la misma longitud del buffer): con la espera fija se
        // quedaba a medias y el prompt final se perdia.
        if (esIos) {
          __esperarConsolaInactiva(line, CONSOLA_SALIDA_TOPE_MS, 2, CONSOLA_SALIDA_PASO_MS, device);
        }
        // Corte por snapshot y, si el buffer ha desbordado y ya no es prefijo,
        // por el eco del comando (`cmd` es el ancla). Nunca el buffer entero.
        corte = __pageThrough(line, __corte(__leerBuffer(line), before, cmd), before, cmd, device);
        output = corte.texto;
        if (!corte.limpio) cortesDegradados++;
        if (output.length > maxChars) output = output.substring(output.length - maxChars);
      }

      var status = execError ? "error" : __resolveStatus(statusRaw, output);

      // Defensa extra del arranque: el banner de un 2911 puede llegar al buffer
      // ASINCRONAMENTE, DESPUES de que se tomara el `before` de este comando, y
      // entonces se cuela dentro de su slice. Si la salida trae un bloque de
      // arranque, el comando no llego a ejecutarse de verdad: se NUNCA reporta
      // "ok" (preferimos fallar visiblemente a devolver basura como si fuera
      // salida valida) y se cuenta para avisar en el payload.
      // OJO: con el corte por ancla esto deberia ser RARO (el banner esta al
      // principio del buffer y el corte sale pegado al eco del comando). Se
      // mantiene la degradacion a "unknown" a proposito: si vuelve a pasar hay
      // que verlo, no taparlo.
      if (__bloqueDeArranque(output)) {
        arranquePendiente++;
        if (status === "ok") status = "unknown";
      }

      var fila = { command: cmd, status: status, output: output };
      // Motivo del corte SOLO cuando no fue limpio: en el caso normal la fila
      // conserva exactamente su forma (`command`/`status`/`output`).
      if (canRead && !corte.limpio) fila.corte = corte.motivo;
      results.push(fila);
    }

    var summary = { total: results.length, ok: 0, errors: 0 };
    for (var r = 0; r < results.length; r++) {
      if (results[r].status === "ok") summary.ok++;
      else summary.errors++;
    }

    var payload = {
      success: true,
      deviceName: deviceName,
      deviceType: deviceType,
      results: results,
      summary: summary,
    };
    if (rootWarning) payload.warning = rootWarning;
    // Diagnostico del despertar cuando salio mal (motivos en espanol, sin las
    // frases en ingles que la suite test-pt usa como marcador de consola sucia):
    // permite ver por que los `status` de results[i] han salido "unknown".
    if (despertar && despertar.ok === false) payload.despertar = despertar;
    // Diagnostico del ajuste de modo: SOLO si algo salio raro (prompt ilegible,
    // transicion cortada o prompt que no acabo en el modo pedido). Con todo
    // correcto el campo no aparece, y results/summary/warning/despertar
    // conservan su forma.
    if (ajusteModo && ajusteModo.avisos.length) payload.modo = ajusteModo;
    // Preambulo profilactico aplicado en ESTA llamada (codigos cortos en
    // espanol, sin texto de consola): deja constancia de que se han emissionado
    // `terminal length 0` y/o `no ip domain-lookup` (que MODIFICAN la
    // configuracion del equipo) para que se vea en el diagnostico.
    if (preambulo && preambulo.emitido) payload.preambulo = preambulo.comandos;
    // Cuantos comandos.trajeron un bloque de ARRANQUE en su salida: el equipo
    // seguia arrancando y ese comando no llego a ejecutarse (su `status` no
    // puede ser "ok"). Se avisa para no perder el motivo del fallo.
    if (arranquePendiente > 0) payload.arranque_pendiente = String(arranquePendiente);
    // Corte DEGRADADO: algun `output` no es el delta fiable de su comando (el
    // buffer de PT habia perdido la cabeza y el eco del comando tampoco
    // aparecia, p. ej. porque llego mutilado). `salida_recortada` es cuantos
    // comandos son poco fiables y cada uno lleva su motivo en
    // `results[i].corte` ("sin_ancla" | "sin_before"). Con el corte limpio
    // (caso normal) estos campos NO aparecen: la forma del payload no cambia.
    if (cortesDegradados > 0) {
      payload.corte = "degradado";
      payload.salida_recortada = String(cortesDegradados);
    }
    // Cuantos comandos se teclearon con la consola todavia ocupada (PT perdia el
    // primer caracter). Se manda igualmente: es informacion, no un bloqueo.
    if (consolaOcupada > 0) payload.consola_ocupada = String(consolaOcupada);
    return payload;
  } catch (error) {
    return fail("Error running device commands", error);
  }
};

// ---------------------------------------------------------------------------
// MOTOR DE COMANDOS EN DOS FASES (`runCommandAsync` + `pollCommandResult`)
//
// POR QUE EXISTE. `runDeviceCommands` envia el comando y luego ADIVINA cuando ha
// terminado: manda el lote, espera `waitMs` a ciegas con `__busyWait` (espera
// ACTIVA) y recorta el buffer con heuristicas. Con un comando lento (`ping`) la
// espera se queda corta y la salida sale vacia o truncada.
//
// LA SENAL EXACTA. Packet Tracer tiene un evento propio para esto:
// `commandEnded` de la linea de consola, que dispara cuando el comando EN CURSO
// ha terminado de verdad (probado por el usuario en
// `examples/PING-EXTENCION.md:186-206` y `:242-244`):
//
//   terminalLine.registerEvent("commandEnded", null, onCommandEnded);
//   function onCommandEnded(src, args) { ... var full = terminalLine.getOutput(); }
//   terminalLine.unregisterEvent("commandEnded", null, onCommandEnded);
//
// (El evento hermano `terminalUpdated` NO sirve como senal de fin: no se dispara
// siempre, y ademas su payload es el texto del tick, no el fin del comando.)
//
// POR QUE SON DOS FASES Y NO UNA. El evento NO puede awaited dentro de una
// llamada nuestra: `__busyWait` es un busy-wait REAL
// (`while (Date.now() - start < ms) {}`) que bloquea el hilo del Script Engine
// de PT, que es monohilo y comparte el proceso con la UI. Mientras una llamada
// nuestra esta en curso, PT no despacha eventos: `commandEnded` se encola y
// salta DESPUES de que volvamos, cuando ya estamos fuera de la funcion. Por eso
// no vale un `while (!terminado) {}`: jamas saldria.
//
//   1) `runCommandAsync` asegura el modo, REGISTRA `commandEnded`, envia el lote y
//      devuelve `pendienteId` de inmediato.
//   2) `pollCommandResult` consulta ese pendiente en llamadas POSTERIORES del
//      backend, que es cuando el motor ya puede despachar el evento: si salto,
//      `done:true` con `fuente:"commandEnded"`; si no, `en_curso` para que el
//      host repita.
//
// `results` sale con la MISMA forma que `runDeviceCommands`
// (`{command, status, output}`, con `corte` solo si el corte fue degradado) para
// que el backend reutilice el parseo que ya tiene. El corte se hace con
// `__corte(full, before, comando)` usando el `before` capturado ANTES de cada
// comando y el propio comando como ancla; `status` sale de `__resolveStatus`, con
// la misma triada `ok`/`error`/`unknown` y la misma regla de que salida vacia
// NUNCA es `ok`.
//
// REGISTRO EN BLOQUE (UNA VEZ POR LOTE, NO POR COMANDO). Un `commandEnded`
// cierra el comando EN CURSO, asi que un evento por comando no seria una senal
// de "el lote termino": la del ultimo que se teclee. Por eso el evento se
// registra UNA vez por lote, antes del primer comando. Si saltara antes de
// tiempo (por ejemplo por el `enable` del ajuste de modo) NO se descarta: el
// handler marca `done` igualmente y anade el diagnostico `eventoEn` con cuantos
// comandos se habian enviado; si al backend le hace falta mas, llama otra vez y
// el siguiente `getOutput()` ya tiene el resto (o vuelve a lanzar el lote).
// ---------------------------------------------------------------------------

// Techo de PENDIENTES VIVOS a la vez. Al superarlo se purga por antiguedad (el
// mas viejo primero, desregistrando su evento antes de borrarlo): cada entrada
// retiene una referencia a la linea de consola y a su handler, asi que el mapa no
// puede crecer sin limite aunque el backend abandone un pendiente.
var PENDIENTES_MAX = 32;
// Techo de la espera interna de un `pollCommandResult` (`esperarMs`). El host
// manda en el ritmo (`esperarMs` por defecto 0 = no esperar), asi que este techo
// solo acota el uso opcional de un presupuesto.
var PENDIENTE_ESPERAR_MAX_MS = 3000;
// Vigencia de un pendiente: si el evento no salta (o la API no existe), tras este
// plafond el poll devuelve el estado leyendo `getOutput()` en ese momento, con
// `fuente:"buffer"` y el aviso `motivo:"presupuesto_vencido"`. Es la RED DE
// SEGURIDAD, no una politica: esta por encima del presupuesto del host (25 s en
// `packages/server/src/client/PacketTracerConsola.ts`, `BUDGET_MS_POR_DEFECTO`)
// para no robarle la palabra -- si el evento nunca salta, el host es quien decide
// como seguir (releyendo la consola sin re-ejecutar)-- y para que ningun
// pendiente se quede abierto para siempre si el host lo abandona.
var PENDIENTE_VIGENCIA_MS = 60000;
// Espera por defecto de las FASES DE ARRANQUE (despertar, ajuste de modo,
// preambulo): la misma que usaria `runDeviceCommands` cuando el caller no pide
// ninguna. El `waitMs` de aqui es una espera MINIMA previa al envio, no la de
// captura de la salida, asi que no se reutiliza para arrancar la consola.
var PENDIENTE_ESPERA_ARRANQUE = 250;
// Margen MINIMO que se paga tras cada comando del lote en `runCommandAsync`.
// Antes no habia suelo: con `waitMs` 0 (el default) el lote entero se tecleaba
// seguido sin ninguna espera, y PT se comia el PRIMER caracter del comando
// siguiente ("% Invalid input detected"). La ruta sincrona siempre paga `waitMs`
// por comando (250 ms por defecto), asi que 40 ms es el suelo conservador que
// evita el comando mutilado sin pagar el coste entero de la sincrona.
var PENDIENTE_ESPERA_POR_COMANDO_MIN_MS = 40;
// Techo del margen por comando. 250 ms es el `waitMs` por defecto de
// `runDeviceCommands`, que es la referencia de "lo que PT necesita para aceptar un
// comando": pagar mas aqui solo congelaria la UI de PT (el `__busyWait` es una
// espera ACTIVA) sin evitar el comando mutilado. Antes el tope eran 150 ms, con lo
// que un host que pidiera 1.500 ms por comando se quedaba en 150.
var PENDIENTE_ESPERA_POR_COMANDO_TOPE_MS = 250;

// Mapa de pendientes vivos (`pendienteId` -> pendiente) y contador monotono de
// ids.
//
// POR QUE SOBREVIVEN ENTRE LLAMADAS. NO es por `runCode`: `runCode`
// (`runcode.js:3`) compila el texto con `new Function`, asi que cada llamada
// ejecuta su propio ambito de funcion y lo que declare ahi se muere al
// terminar. Sobreviven porque Packet Tracer CARGA este fichero como un SCRIPT
// CLASICO de ambito global cuando se instala la extension: las tools que expone
// (`runCommandAsync`, `pollCommandResult`, ...) y estos `var` de nivel superior
// cuelgan todos del mismo global, asi que un pendiente abierto por un
// `runCommandAsync` se sigue viendo desde el `pollCommandResult` de OTRA llamada
// (que es justo lo que hace posible el sondeo en fases separadas).
var __PENDIENTES_COMANDO = {};
var __PENDIENTES_COMANDO_SEQ = 0;
var __PENDIENTES_COMANDO_VIVOS = 0;

// Desregistra el `commandEnded` de un pendiente.
//
// POR QUE UNA REFERENCIA ESTABLE. `unregisterEvent` exige EXACTAMENTE la misma
// funcion que se paso en `registerEvent` (el motor la compara por identidad), no
// una equivalente: si el handler se recreara al desregistrar, la suscripcion no
// se encontraria, el evento seguiria vivo y cada `runCommandAsync` dejaria una
// suscripcion huerfana que dispara contra un pendiente ya cerrado. Por eso el
// handler se crea UNA vez por pendiente y se guarda en `p.handler`, y el mismo
// `p.handler` es el que se pasa aqui.
function __desregistrarFinDeComando(p) {
  if (!p || !p.handler || !p.line) return false;
  if (typeof p.line.unregisterEvent !== "function") return false;
  var ok = false;
  try {
    p.line.unregisterEvent("commandEnded", null, p.handler);
    ok = true;
  } catch (eUnreg) {
    ok = false;
  }
  // `moreDisplayed` comparte la REFERENCIA ESTABLE `p.handlerMore`: si no se
  // dessuscribe aqui, la suscripcion sobrevive al cierre del pendiente y cada
  // lote dejaria una huerfana (el mismo problema documentado arriba).
  if (p.handlerMore) {
    try {
      p.line.unregisterEvent("moreDisplayed", null, p.handlerMore);
    } catch (eUnregMore) {
      /* el evento puede no haberse registrado: es seguro */
    }
  }
  return ok;
}

// Cierra un pendiente: lo borra del mapa y desregistra su evento. El borrado va
// PRIMERO, para que un `commandEnded` que llegue durante la limpieza no
// reencuentre la entrada. Devuelve el pendiente cerrado, o null si ya no estaba.
function __cerrarPendiente(id) {
  var p = __PENDIENTES_COMANDO[id];
  if (!p) return null;
  delete __PENDIENTES_COMANDO[id];
  __PENDIENTES_COMANDO_VIVOS--;
  p.cerrado = true;
  // El diagnostico de bloqueos vive en el PENDIENTE (se acumula ronda a ronda)
  // y se vacia aqui: el objeto ya no esta en el mapa, pero el handler del evento
  // sigue vivo hasta el desregistro y no debe dejar rastros del lote cerrado.
  p.bloqueoResuelto = "";
  p.comandoConsumido = false;
  p.paginasPagadas = 0;
  p.accionesBloqueo = 0;
  __desregistrarFinDeComando(p);
  // El equipo se suelta la ultima: la linea se conserva (es la que ya tenia el
  // pendiente) pero el `device` no hace falta para nada mas.
  p.device = null;
  return p;
}

// Cierra TODOS los pendientes. Lo dejaria preparado `cleanUp()` de `main.js`
// (que hoy solo limpia el item de menu) para que al recargar la extension no
// queden eventos vivos: se documenta en el README porque `main.js` no se toca
// desde aqui.
function __cerrarTodosLosPendientes() {
  var cerrados = 0;
  for (var id in __PENDIENTES_COMANDO) {
    if (!Object.prototype.hasOwnProperty.call(__PENDIENTES_COMANDO, id)) continue;
    if (__cerrarPendiente(id)) cerrados++;
  }
  return cerrados;
}

// Cierra los pendientes de un equipo: un `runCommandAsync` nuevo sobre el mismo
// equipo invalida el anterior (si no, se acumularian eventos y buffers del mismo
// `line` y los cortes cruzarian snapshots de dos lotes).
function __cerrarPendientesDe(deviceName) {
  var cerrados = 0;
  for (var id in __PENDIENTES_COMANDO) {
    if (!Object.prototype.hasOwnProperty.call(__PENDIENTES_COMANDO, id)) continue;
    var p = __PENDIENTES_COMANDO[id];
    if (p && p.deviceName === deviceName) {
      if (__cerrarPendiente(id)) cerrados++;
    }
  }
  return cerrados;
}

// Id del pendiente mas VIEJO (menor `orden`), o "" si no hay ninguno.
function __pendienteMasViejo() {
  var id = "";
  var orden = -1;
  for (var clave in __PENDIENTES_COMANDO) {
    if (!Object.prototype.hasOwnProperty.call(__PENDIENTES_COMANDO, clave)) continue;
    var p = __PENDIENTES_COMANDO[clave];
    if (!p) continue;
    if (orden === -1 || p.orden < orden) {
      orden = p.orden;
      id = clave;
    }
  }
  return id;
}

// Purga por antiguedad: mientras haya mas de `PENDIENTES_MAX` pendientes,
// cierra el mas viejo (el primero que entro). Nunca deja fugas: cada cerrado
// desregistra su evento antes de borrarse del mapa. Devuelve cuantos se purgaron.
function __purgarPendientes() {
  var purgados = 0;
  while (__PENDIENTES_COMANDO_VIVOS > PENDIENTES_MAX) {
    var id = __pendienteMasViejo();
    if (!id) break;
    if (!__cerrarPendiente(id)) break;
    purgados++;
  }
  return purgados;
}

// Relectura diferida del buffer de un pendiente ya terminado. `setTimeout` en el
// motor de scripts de PT es DIFERIDO (su callback corre despues de que la
// llamada devuelve), asi que no sirve para esperar DENTRO de un poll: se usa
// solo para esto, para el caso en que PT siga volcando la salida cuando
// salta el evento (el propio `examples/PING-EXTENCION.md:191-204` espera 150 ms
// antes de leer). Devuelve si se pudo armar (si el motor no expone `setTimeout`).
function __armarRefresco(p, ms) {
  if (typeof setTimeout !== "function") return false;
  try {
    setTimeout(function () {
      try {
        if (!p || p.cerrado) return;
        var texto = __leerBuffer(p.line);
        if (texto.length > __texto(p.bufferFinal).length) p.bufferFinal = texto;
      } catch (eRefresco) {
        // un refresco que falla no puede tumbar el motor de scripts
      }
    }, ms);
    return true;
  } catch (eTimer) {
    return false;
  }
}

// ---------------------------------------------------------------------------
// FASE 1: envia el lote, registra `commandEnded` y devuelve el `pendienteId`.
// ---------------------------------------------------------------------------
runCommandAsync = function (deviceName, commands, options) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: "Device " + deviceName + " not found" };
    }

    // Tolerancia: un string se parte por lineas; el contrato pide array.
    if (typeof commands === "string") commands = commands.split("\n");
    if (!Array.isArray(commands)) {
      return { success: false, error: "commands debe ser un array de strings" };
    }

    var opts = options || {};
    // `waitMs` aqui es una espera MINIMA (que PT acepte el comando), no la de
    // captura de la salida: por defecto 0 y con tope de
    // `PENDIENTE_ESPERA_POR_COMANDO_TOPE_MS`. La espera de verdad la hace el
    // backend entre polls.
    var waitMs = typeof opts.waitMs === "number" && opts.waitMs > 0 ? opts.waitMs : 0;
    if (waitMs > PENDIENTE_ESPERA_POR_COMANDO_TOPE_MS) waitMs = PENDIENTE_ESPERA_POR_COMANDO_TOPE_MS;
    // Margen que se paga tras CADA comando del lote. Even cuando el host no pide
    // espera ninguna (`waitMs` 0) se paga el suelo: sin margen entre dos
    // `enterCommand` seguidos PT se come el primer caracter del segundo comando.
    // El total sigue acotado (N comandos x tope) y no es un timeouteo: la captura
    // de la salida la hace el poll.
    var margenPorComando =
      waitMs > PENDIENTE_ESPERA_POR_COMANDO_MIN_MS ? waitMs : PENDIENTE_ESPERA_POR_COMANDO_MIN_MS;
    var maxChars = typeof opts.maxChars === "number" && opts.maxChars > 0 ? opts.maxChars : 8000;

    // Modos validos SOLO: "", "user", "enable", "global" (misma semantica y
    // mismo `__defaultMode` que `runDeviceCommands`).
    var mode = typeof opts.mode === "string" ? opts.mode : "";
    if (mode !== "" && mode !== "user" && mode !== "enable" && mode !== "global") mode = "";
    if (!mode) mode = __defaultMode(device);

    var line = __resolveLine(device);
    if (!line) {
      return {
        success: false,
        error: "El dispositivo '" + deviceName + "' no tiene linea de comandos accesible",
      };
    }
    var canRead = !!(line && line.getOutput !== undefined);

    // La espera por consola inactiva (ANTES de teclear y al final, para
    // confirmar que PT ha terminado de escribir) es un asunto de la CLI de IOS:
    // en PC/Server/Laptop el prompt no es de IOS y la espera no se cumple nunca,
    // asi que solo costaria tiempo. Se calcula UNA vez aqui y se guarda en el
    // pendiente porque el poll lo necesita tambien (sin tener que volver a
    // preguntar el tipo de equipo, y sin que un pendiente se gatee con un
    // criterio distinto del que se uso al enviar).
    var esIos = __defaultMode(device) === "enable";

    // Solo los comandos con texto van al lote: los vacios no se teclean.
    var enviados = [];
    for (var c = 0; c < commands.length; c++) {
      var cand = commands[c] === undefined || commands[c] === null ? "" : String(commands[c]);
      if (cand.replace(/^\s+|\s+$/g, "")) enviados.push(cand);
    }

    // Fases de arranque: despertar la consola y ASEGURAR EL MODO antes de
    // registrar el evento. Van primero a proposito, porque cada una teclea
    // comandos propios (`show clock` de sondeo, `enable`, `terminal length 0`,
    // `no ip domain-lookup`) que generarian su propio `commandEnded`: si el
    // evento se registrara antes, ese `commandEnded` del andamiaje se
    // atribuiria al lote y el primer poll cortaria la salida a medias.
    // Salen antes del primer `before`, asi que los cortes de abajo los
    // descartan y `results` se queda solo con la salida del lote.
    var esperaArranque = waitMs > 0 ? waitMs : PENDIENTE_ESPERA_ARRANQUE;
    if (esperaArranque > 1000) esperaArranque = 1000;
    var despertar = canRead ? __despertarConsola(line, device, esperaArranque) : null;
    var consolaBloqueada =
      !!despertar && despertar.ok === false && despertar.motivo === "bloqueo_dns_translating";

    // Un pendiente del mismo equipo invalida al anterior: se cierra ANTES de
    // registrar el evento nuevo para que no queden dos eventos vivos sobre la
    // misma linea de consola.
    var cerrados = __cerrarPendientesDe(deviceName);

    var ajusteModo = null;
    var preambulo = null;
    var bloqueado = consolaBloqueada || enviados.length === 0;
    if (!bloqueado) {
      ajusteModo = __asegurarModo(line, device, mode, esperaArranque, enviados);
      if (opts.preambulo !== false) {
        preambulo = __preambuloSeguro(device, line, esperaArranque);
        // El preambulo entra y sale de config para emitir `no ip domain-lookup`:
        // si el lote esperaba otro modo hay que volver a asegurarlo (es lo mismo
        // que hace `runDeviceCommands`).
        if (preambulo && preambulo.emitido && preambulo.cambioModo) {
          var reasegurado = __asegurarModo(line, device, mode, esperaArranque, enviados);
          if (ajusteModo) {
            for (var av = 0; av < reasegurado.avisos.length; av++) {
              if (ajusteModo.avisos.indexOf(reasegurado.avisos[av]) === -1) {
                ajusteModo.avisos.push(reasegurado.avisos[av]);
              }
            }
          } else {
            ajusteModo = reasegurado;
          }
        }
      }
    }

    // `reiniciarSimulacion`: aquí NO es el caso de uso (el que necesita el
    // reinicio de la linea de tiempo es el ping por PDU) y reiniciar con comandos
    // en vuelo es justo lo que no queremos, asi que solo se hace si lo piden
    // explicitamente, y en modo best effort.
    var resetSimulacion = false;
    if (opts.reiniciarSimulacion === true) {
      try {
        var sim = ipc.simulation();
        if (sim && typeof sim.resetSimulation === "function") {
          sim.resetSimulation();
          resetSimulacion = true;
        }
      } catch (eReset) {
        resetSimulacion = false;
      }
    }

    // Alta del pendiente. `t0` es el reloj de simulacion (informativo: en el
    // camino de comandos no hay PDU que medir, asi que sale 0 si PT no lo
    // expone).
    __PENDIENTES_COMANDO_SEQ++;
    var pid = "pc" + __PENDIENTES_COMANDO_SEQ;
    var p = {
      id: pid,
      orden: __PENDIENTES_COMANDO_SEQ,
      deviceName: deviceName,
      comandos: enviados,
      modo: mode,
      pasos: [],
      enviados: 0,
      line: line,
      canRead: canRead,
      // `device` se guarda para el resolutor de bloqueos: `__sendCommand` cae a
      // el dispositivo cuando la linea no expone `enterCommand`, y el desbloqueo
      // (`no` del dialogo, Ctrl+^ del lookup) lo necesita igual que el envio del
      // lote. Se suelta al cerrar el pendiente.
      device: device,
      handler: null,
      eventoRegistrado: false,
      // Suscripcion de `moreDisplayed` viva (se registra mas abajo, tras el alta).
      // Se inicializa para que nunca quede `undefined` y se reporta en el payload
      // del poll: sin ella el paginador solo se ve buscando `--More--` a pelo.
      pagerRegistrado: false,
      // `via` de tecleo ACUMULADA EN ESTE pendiente (paginador y tecla suelta).
      // Las globales `__PAGINADOR_VIA_ULTIMA`/`__ENTER_VIA_ULTIMA` son memoria
      // global de PT y nunca se reinician, asi que reportarlas en el payload hacia
      // que con dos lotes vivos el lote B dijera el `via` del lote A (y de otro
      // equipo). Estas dos son las del PROPIO pendiente y empiezan vacias.
      pagerVia: "",
      enterVia: "",
      done: false,
      cerrado: false,
      vacio: enviados.length === 0 || bloqueado,
      bufferFinal: "",
      eventoEn: -1,
      // Diagnostico acumulado de bloqueos de consola (ver `__resolverBloqueo`):
      // que se atendio (`bloqueoResuelto`), si eso se comio el comando
      // (`comandoConsumido`) y los contadores que tan los topes por pendiente.
      bloqueoResuelto: "",
      comandoConsumido: false,
      paginasPagadas: 0,
      accionesBloqueo: 0,
      maxChars: maxChars,
      // Espera por el FIN DE ESCRITURA de PT antes de cortar la salida. Por
      // defecto `true` y NO `false`: el evento `commandEnded` significa "el
      // comando termino", no "PT dejo de escribir", y el poll que sale por
      // `fuente:"buffer"` (sin evento, o con el presupuesto vencido) entrega la
      // salida A MEDIAS sin ella. Es lo que ya hacia la ruta sincronica tras
      // CADA comando. Un host puede pedir `false` explicitamente (`esperaFin:false`)
      // cuando lo que quiere es la lectura mas rapida posible.
      esperaFin: opts.esperaFin !== false,
      // Equipo IOS: unico caso en el que la espera por consola quieta tiene
      // sentido (mismo flag que usa el envio del lote, ver arriba).
      esIos: esIos,
      creadoEn: Date.now(),
      t0: 0,
    };
    try {
      var sim0 = ipc.simulation();
      if (sim0 && typeof sim0.getCurrentSimTime === "function") {
        p.t0 = Number(sim0.getCurrentSimTime()) || 0;
      }
    } catch (eT0) {
      p.t0 = 0;
    }
    __PENDIENTES_COMANDO[pid] = p;
    __PENDIENTES_COMANDO_VIVOS++;
    // Limite duro con purga por antiguedad: nunca hay fugas, aunque el backend
    // abandone un pendiente sin sondearlo nunca mas.
    var purgados = __purgarPendientes();

    // REGISTRO DEL EVENTO, una vez por lote. Todo en try/catch: si `registerEvent`
    // no existe (PT que no expone esa API) o lanza, el pendiente sigue siendo
    // valido y `eventoRegistrado:false` le dice al backend que NO puede esperar
    // la senal y que debe leer el buffer (o usar `esperarMs`).
    p.handler = function (src, args) {
      try {
        p.done = true;
        p.eventoEn = p.enviados;
        p.bufferFinal = __leerBuffer(p.line);
      } catch (eEvento) {
        // Un evento que revienta no puede tumbar el motor de scripts: el
        // pendiente se marca como terminado igualmente y el poll leera el
        // buffer.
        p.done = true;
      }
    };
    try {
      if (typeof line.registerEvent === "function") {
        line.registerEvent("commandEnded", null, p.handler);
        p.eventoRegistrado = true;
      }
    } catch (eRegistro) {
      p.eventoRegistrado = false;
    }

    // EVENTO `moreDisplayed`: la API oficial de `ConsoleLine` lo declara
    // (`TerminalLine`/`ConsoleLine`, member list) y es la SENAL FIABLE de que el
    // paginador esta abierto, mucho mas fiable que buscar la cadena `--More--` en
    // el buffer (que ademas no siempre la trae: medido en PT 9, el buffer se
    // quedaba en ` --More-- ` sin que `enterChar(32)` avanzara nada). Cuando
    // salta, el poll paga pagina de verdad.
    if (typeof line.registerEvent === "function") {
      try {
        p.handlerMore = function (srcMore, argsMore) {
          try {
            p.pagerVisto = true;
          } catch (eMore) {
            /* nada que hacer */
          }
        };
        line.registerEvent("moreDisplayed", null, p.handlerMore);
        p.pagerRegistrado = true;
      } catch (eMoreRegistro) {
        p.pagerRegistrado = false;
      }
    }

    // Envio del lote. Por cada comando se espera a que la consola quede INACTIVA
    // y se captura el `before` ANTES de teclear (es el snapshot que usara
    // `__corte` en el poll), igual que hace `runDeviceCommands`: con la consola
    // ocupada PT se come el PRIMER caracter del comando. En el caso normal el
    // sondeo no cuesta NADA (una lectura, cero esperas) y solo paga si el
    // equipo de verdad sigue escribiendo.
    var errores = 0;
    var consolaOcupada = 0;
    for (var i = 0; i < enviados.length; i++) {
      var cmd = enviados[i];
      if (bloqueado) {
        // Consola bloqueada por un lookup DNS: no se teclea nada y cada comando
        // sale con `output:""` y `status:"unknown"` (NUNCA "ok" ni "error"), con
        // el diagnostico del despertar en `payload.despertar` y el motivo del
        // paso en `execError` para que se sepa POR QUE no hay salida. El `unknown`
        // es el del CONTRATO (`__statusFromOutput`): sin ejecucion no se puede
        // afirmar nada, y es exactamente lo que devuelve la ruta sincronica
        // (`runDeviceCommands`) para el mismo caso.
        p.pasos.push({
          command: cmd,
          before: "",
          statusRaw: undefined,
          execError: "consola_bloqueada_por_dns",
        });
        errores++;
        continue;
      }
      if (canRead && esIos) {
        var libre = __esperarConsolaInactiva(
          line,
          CONSOLA_OCUPADA_TOPE_MS,
          1,
          CONSOLA_OCUPADA_PASO_MS,
          device
        );
        if (!libre.inactiva) consolaOcupada++;
      }
      var before = canRead ? __leerBuffer(line) : "";
      var statusRaw;
      var execError = null;
      try {
        statusRaw = __sendCommand(line, device, cmd, mode);
      } catch (eCmd) {
        execError = __mensajeDeError(eCmd);
      }
      p.pasos.push({ command: cmd, before: before, statusRaw: statusRaw, execError: execError });
      if (execError) errores++;
      p.enviados++;
      // Margen POR COMANDO para que PT acepte el siguiente: se paga aqui, dentro
      // del bucle, y no una sola vez al final. Medido en PT 9: mandando el lote
      // entero seguido PT se come el PRIMER caracter del comando siguiente y sale
      // `% Invalid input detected` sin que nada lo señale. La ruta sincrona paga
      // `waitMs` por comando (`runDeviceCommands`); con el pago unico anterior, 6
      // comandos costaban 150 ms en total frente a los 1.500 ms de la sincrona.
      if (margenPorComando > 0) __busyWait(margenPorComando);
    }

    // Ya no se paga una espera final para el lote: el margen por comando de
    // arriba incluye el del ULTIMO, que es el que importa (el evento `commandEnded`
    // no puede saltar mientras el motor esta en un `__busyWait`, asi que esperar
    // aqui no aportaba nada).

    var payload = {
      success: true,
      pendienteId: pid,
      deviceName: deviceName,
      comandos: enviados,
      modo: mode,
      eventoRegistrado: p.eventoRegistrado,
      // Si se pudo suscribir `moreDisplayed` (la senal fiable de paginador
      // abierto). Si sale `false` y el comando se queda en `en_curso` con el
      // buffer lleno, el diagnostico dice que PT no da esa senal en esa build.
      pagerRegistrado: p.pagerRegistrado === true,
      // Como se ha resuelto el gate de la espera por fin de escritura (que se
      // aplica en el poll, no aqui): deja claro de antemano si el equipo es IOS.
      esperaFin: p.esperaFin,
      esIos: p.esIos,
      t0: p.t0,
    };
    if (!canRead) payload.warning = "console_output_unavailable";
    if (despertar && despertar.ok === false) payload.despertar = despertar;
    if (ajusteModo && ajusteModo.avisos.length) payload.modo = ajusteModo;
    if (preambulo && preambulo.emitido) payload.preambulo = preambulo.comandos;
    if (resetSimulacion) payload.resetSimulacion = true;
    if (errores > 0) payload.enviadosConError = String(errores);
    if (consolaOcupada > 0) payload.consola_ocupada = String(consolaOcupada);
    // Diagnostico de limpieza: pendientes cerrados porsupersederse con este
    // lote y purgados por el limite duro. Solo aparece si paso algo.
    if (cerrados > 0) payload.pendientesCerrados = String(cerrados);
    if (purgados > 0) payload.pendientesPurgados = String(purgados);
    return payload;
  } catch (error) {
    return fail("Error launching async commands", error);
  }
};

// ---------------------------------------------------------------------------
// FASE 2: sondea un pendiente abierto y devuelve el resultado del lote.
//
// El ritmo es del HOST (pregunta, duerme fuera de la llamada y vuelve a
// preguntar), no de esta funcion: no se espera por su cuenta. `esperarMs` es el
// PRESUPUESTO INTERNO que el host reparte ("una parte del intervalo se la pide a
// la extension"): cuanto esperar DENTRO de esta ronda antes de responder.
//
// `esperarMs` NO fuerza `done:true`. Si lo hiciera, CADA ronda devolveria una
// lectura a ciegas de `getOutput()` y el ciclo del evento no serviria de nada:
// seria exactamente el falso OK que este motor viene a sustituir (un `ping`
// lento volveria "terminado" a los 250 ms con la salida a medias). Con el evento
// registrado y sin saltar, la respuesta es `en_curso` y el host repite; el
// "siempre se puede avanzar" lo dan las tres vias de salida reales (abajo).
// ---------------------------------------------------------------------------
pollCommandResult = function (pendienteId, options) {
  try {
    var id = pendienteId === undefined || pendienteId === null ? "" : String(pendienteId);
    var p = __PENDIENTES_COMANDO[id];
    if (!p) {
      return { success: false, error: "pendiente desconocido o ya cerrado" };
    }

    var opts = options || {};
    var esperarMs = typeof opts.esperarMs === "number" && opts.esperarMs > 0 ? opts.esperarMs : 0;
    if (esperarMs > PENDIENTE_ESPERAR_MAX_MS) esperarMs = PENDIENTE_ESPERAR_MAX_MS;
    var maxChars =
      typeof opts.maxChars === "number" && opts.maxChars > 0 ? opts.maxChars : p.maxChars;
    var esperaFin = opts.esperaFin === undefined ? p.esperaFin : opts.esperaFin === true;

    var pendienteMs = Date.now() - p.creadoEn;
    if (pendienteMs < 0) pendienteMs = 0;

    // Presupuesto interno opcional. `setTimeout` en el motor de scripts de PT es
    // diferido (no se puede esperar dentro de un poll, `runCode` es
    // sincrono), asi que la espera la hace el presupuesto acotado de
    // `__busyWait` y `setTimeout` solo arma el refresco diferido del buffer.
    // MIENTRAS ESPERA NO PUEDE SALTAR EL EVENTO (mismo hecho que motiva las dos
    // fases): por eso la exactitud no se pierde, el siguiente poll ya lo ve.
    if (esperarMs > 0) {
      __armarRefresco(p, esperarMs);
      __busyWait(esperarMs);
      pendienteMs = Date.now() - p.creadoEn;
      if (pendienteMs < 0) pendienteMs = 0;
    }

var porVigencia = pendienteMs >= PENDIENTE_VIGENCIA_MS;

    // BLOQUEOS DE CONSOLA. MEDIDO en PT 9 contra la suite `test-pt`: `show
    // running-config` sobre un 2911 recien creado no termina nunca (45 sondeos,
    // 55 s) porque el equipo termino de arrancar DESPUES del despertar, su aviso
    // "Press RETURN to get started!" se quedo esperando y el comando se consumio
    // como la tecla del RETURN. Antes solo se pagaba el `--More--` y nunca se
    // pulsaba Enter, que es justo donde se pasa el 99 % de la espera.
    //
    // Ahora cada ronda resuelve lo que haya (ver `__resolverBloqueo`):
    //   * el paginador `--More--` con `enterChar(32)` (`consumioComando:false`:
    //     el comando sigue vivo, es lo que ya hacia);
    //   * el aviso de arranque / el dialogo `[yes/no]` / el lookup DNS con la
    //     tecla que corresponde (`consumioComando:true`: el comando se ha
    //     perdido, ver mas abajo).
    //
    // TOPES por pendiente: `PAGINADOR_MAX_PAGINAS` para los espacios (el de
    // siempre) y `BLOQUEO_MAX_PROMPTS` para las tecleadas de prompt, para que un
    // bloqueo que no se deje satisfacer no nos deje looping. Al superarlos se
    // DEJA de actuar y se dice en el payload (`bloqueoAgotado`).
    var paginasPagadas = 0;
    var bloqueoAgotado = false;
    var bufferEnEspera = "";
    if (p.paginasPagadas === undefined) p.paginasPagadas = 0;
    if (p.accionesBloqueo === undefined) p.accionesBloqueo = 0;
    if (p.canRead && p.line) {
      try {
        // El resolutor solo teclea mientras el evento NO ha saltado: si ya salto,
        // el comando termino y no hay nada que desbloquear.
        if (!p.done) {
          var bloqueo = __resolverBloqueo(p.line);
          if (bloqueo && bloqueo.accion) {
            var esEspacio = bloqueo.accion === "espacio";
            var usados = esEspacio ? p.paginasPagadas : p.accionesBloqueo;
            var tope = esEspacio ? PAGINADOR_MAX_PAGINAS : BLOQUEO_MAX_PROMPTS;
            if (usados >= tope) {
              // Tope alcanzado: no se teclea mas, se sigue esperando al evento.
              bloqueoAgotado = true;
            } else {
              // Las globales `__PAGINADOR_VIA_ULTIMA`/`__ENTER_VIA_ULTIMA` son
              // memoria de "que metodo funciona en PT" y NO se reinician nunca:
              // leerlas tal cual en el payload hacia que, con dos lotes vivos, el
              // lote B reportara el `via` del lote A (y de otro equipo). Se toman
              // ANTES de actuar y solo se atribuye a este pendiente la via que
              // CAMBIE con SU propia accion; a partir de ahi se reporta esa.
              var pagerGlobalAntes = __PAGINADOR_VIA_ULTIMA;
              var enterGlobalAntes = __ENTER_VIA_ULTIMA;
              if (__aplicarBloqueo(p.line, p.device, bloqueo)) {
                if (esEspacio) p.paginasPagadas += 1;
                else p.accionesBloqueo += 1;
                __anadirMotivoBloqueo(p, bloqueo.motivo);
                if (bloqueo.consumioComando) p.comandoConsumido = true;
                if (__PAGINADOR_VIA_ULTIMA !== pagerGlobalAntes) {
                  p.pagerVia = __PAGINADOR_VIA_ULTIMA;
                }
                if (__ENTER_VIA_ULTIMA !== enterGlobalAntes) {
                  p.enterVia = __ENTER_VIA_ULTIMA;
                }
              }
            }
          }
        }
        // Relectura para el veredicto de "el comando ya esta en el buffer" de
        // mas abajo: hace falta el estado POST-accion, no el que se leyo al
        // detectar. Se lee SIEMPRE (tambien con `p.done`), porque ese veredicto
        // decide si el `done` del evento es el fin del comando o el de nuestra
        // propia tecla de desbloqueo.
        bufferEnEspera = __leerBuffer(p.line);
      } catch (eBloqueo) {
        // si no se puede leer o desbloquear la consola, seguimos esperando
      }
      paginasPagadas = p.paginasPagadas;
    }

    // ¿EL PROMPT PENDIENTE SE HA COMIDO EL COMANDO? Cuando el resolutor tecleó
    // algo que SATISFACE un prompt (`consumioComando`) y el comando del lote aun
    // no ha aparecido en el buffer, ese comando esta PERDIDO: no se esta
    // ejecutando, asi que su `commandEnded` no saltara nunca y el host agotaria
    // su presupuesto en silencio. Se devuelve `reintentar` EN VEZ DE
    // `en_curso` para que el host cierre el pendiente y reenvie UNA vez (solo si
    // el llamante declara el comando reintentable). AQUI NO se reintenta: quien
    // sabe si el comando se puede repetir es el host.
    //
    // El eco se busca con `__comandoYaTecleado`, que usa el MISMO criterio que
    // los `results` (`__corte` con el `before` previo y el comando como ancla):
    // si el comando ya esta escrito, el camino normal sigue igual. Se anade una
    // excepcion para el aviso de arranque: mientras siga PENDIENTE el equipo no
    // ha aceptado la CLI, asi que un eco en el buffer no puede ser ejecucion
    // (PT puede haber escrito lo tecleado antes de que la tecla se consumiera), y
    // sin esta excepcion volveriamos al `en_curso` infinito que se quiere
    // arreglar.
    var comandoComido =
      p.comandoConsumido === true &&
      (!__comandoYaTecleado(p.pasos, bufferEnEspera) ||
        __pressReturnPendiente(bufferEnEspera));

    // LAS TRES VIAS DE SALIDA (el host NUNCA se queda esperando una senal que no
    // va a llegar):
    //   1) `p.done`                    -> el evento `commandEnded` salta (senal
    //                                      exacta): `fuente:"commandEnded"`.
    //   2) sin evento disponible / sin
    //      nada que leer / lote vacio -> se responde YA leyendo `getOutput()`:
    //                                      `fuente:"buffer"` (es lo unico que se
    //                                      puede hacer y el host lo trata como
    //                                      lectura de respaldo).
    //   3) `porVigencia`               -> el evento nunca salta (PT que no lo
    //      emite para ese comando): `fuente:"buffer"` + `motivo`, para que el
    //      host sepa que es una lectura tardia y no una senal de fin.
    var fin = p.done || p.vacio || !p.canRead || !p.eventoRegistrado || porVigencia;

    // `reintentar` va ANTES que `en_curso` y que `fin`: teclear el desbloqueo
    // tambien puede hacer saltar el evento de PT, y ese evento NO es el fin del
    // comando del lote (el comando ni se ejecuto), asi que un `done` aqui
    // devolveria salida vacia. El pendiente NO se cierra: decide el host.
    if (comandoComido) {
      var reintento = {
        success: true,
        pendienteId: id,
        done: false,
        estado: "reintentar",
        pendienteMs: pendienteMs,
        eventoRegistrado: p.eventoRegistrado,
        paginasPagadas: paginasPagadas,
        bloqueoResuelto: __texto(p.bloqueoResuelto),
        comandoConsumido: true,
        enterVia: p.enterVia,
        pagerVia: p.pagerVia,
        pagerVisto: p.pagerVisto === true,
        // Se pudo suscribir `moreDisplayed`? Sin esa suscripcion, el paginador
        // solo se detecta buscando `--More--` en el buffer, que en PT 9 no
        // siempre esta: el diagnostico de "no avanzo" se puede leer aqui.
        pagerRegistrado: p.pagerRegistrado === true,
        motivo: "prompt_pendiente_consumio_el_comando",
      };
      if (bloqueoAgotado) reintento.bloqueoAgotado = true;
      return reintento;
    }

    if (!fin) {
      var enCurso = {
        success: true,
        pendienteId: id,
        done: false,
        estado: "en_curso",
        pendienteMs: pendienteMs,
        eventoRegistrado: p.eventoRegistrado,
        paginasPagadas: paginasPagadas,
      };
      if (p.bloqueoResuelto) enCurso.bloqueoResuelto = p.bloqueoResuelto;
      if (p.comandoConsumido) enCurso.comandoConsumido = true;
      if (bloqueoAgotado) enCurso.bloqueoAgotado = true;
      // QUE VIA de Enter funciono en PT 9 (`enterChar13`, `enterChar10`,
      // `enterCommandNl`, `enterCommandVacio` o `""` = ninguna). Se expone la del
      // PROPIO pendiente (`p.enterVia`/`p.pagerVia`), no la global: con dos lotes
      // vivos la global es la del otro lote y el diagnostico era pegajoso.
      enCurso.enterVia = p.enterVia;
      enCurso.pagerVia = p.pagerVia;
      // Suscripcion de `moreDisplayed` viva (ver `runCommandAsync`).
      enCurso.pagerRegistrado = p.pagerRegistrado === true;
      if (p.pagerVisto) enCurso.pagerVisto = true;
      return enCurso;
    }

    // `esperaFin`: misma confirmacion que hace `runDeviceCommands` tras cada
    // comando (consola quieta en dos lecturas). Por defecto se APLICA (el
    // pendiente nace con `esperaFin:true`): el evento `commandEnded` significa
    // "el comando termino", no "PT dejo de escribir", y el poll que sale por
    // `fuente:"buffer"` (sin evento, o por presupuesto vencido) entregaba la
    // salida A MEDIAS sin esta espera. Un host puede pedir `false` explicito.
    //
    // Solo en IOS, y con el MISMO flag que uso el envio del lote (`p.esIos`): en
    // PC/Server/Laptop no hay prompt de IOS, la espera no se cumpliria nunca y
    // solo quemaria hasta `CONSOLA_SALIDA_TOPE_MS` por comando. El motivo se
    // reporta en el payload (`esperaFinAplicada`/`esperaFinMotivo`) para que se
    // sepa si la salida se confirmo o si se leyo a ciegas.
    var esperaFinAplicada = false;
    var esperaFinMotivo = "aplicada";
    if (!esperaFin) esperaFinMotivo = "host_no_lo_pidio";
    else if (!p.canRead || !p.line) esperaFinMotivo = "sin_lectura";
    else if (p.esIos !== true) esperaFinMotivo = "no_ios";
    if (esperaFin && p.canRead && p.line && p.esIos === true) {
      __esperarConsolaInactiva(p.line, CONSOLA_SALIDA_TOPE_MS, 2, CONSOLA_SALIDA_PASO_MS, p.device);
      esperaFinAplicada = true;
    }

    // Buffer final: se relee ahora y, si el handler habia leido ANTES de que PT
    // terminara de volcar la salida, se queda el MAS LARGO de los dos (PT puede
    // seguir escribiendo un poco despues del evento).
    var full = __leerBuffer(p.line);
    if (__texto(p.bufferFinal).length > full.length) full = __texto(p.bufferFinal);

    // Corte por comando: el `before` capturado antes de teclearlo y el propio
    // comando como ancla, exactamente igual que en `runDeviceCommands`.
    //
    // RECORTE POR EL SIGUIENTE SNAPSHOT (por que): los comandos de un lote se
    // envian seguidos y PT no los escribe de uno en uno, asi que al leer el
    // buffer en el poll TODA la salida del lote esta ya dentro y `before[i]` solo
    // acota por abajo: la fila i se tragaria la salida de los comandos i+1..N
    // (que es justo lo que separa una fila de la anterior). Se recorta por
    // arriba con el `before` SIGUIENTE, que es justo donde empieza lo que
    // escribio el comando i+1: asi la fila i sale con la MISMA forma y el mismo
    // contenido que daria `runDeviceCommands` cortando en el momento. Solo se
    // aplica si el corte fue por prefijo y el snapshot siguiente lo extiende (si
    // el buffer desbordó, la aritmetica no seria valida y el corte por ancla se
    // queda como sale).
    var results = [];
    var cortesDegradados = 0;
    var arranquePendiente = 0;
    for (var i = 0; i < p.pasos.length; i++) {
      var paso = p.pasos[i];
      var siguiente = i + 1 < p.pasos.length ? p.pasos[i + 1] : null;
      var output = "";
      var corte = { texto: "", limpio: true, motivo: "prefijo" };
      // Un paso que NO llego a teclearse (consola bloqueada por un lookup DNS)
      // no tiene nada que recortar: su `before` esta vacio y el comando no
      // aparece en el buffer, asi que `__corte` cae al peor caso (`sin_before`) y
      // devuelve los ULTIMOS `CORTE_VENTANA_FINAL` chars del buffer CRUDO (banner
      // de arranque, `Translating no...`, syslog) como si fueran la salida del
      // comando. Se salta el corte y la fila sale VACIA, igual que en la ruta
      // sincronica; el motivo viaja en la fila (`execError`).
      var pasoBloqueado = paso.execError === "consola_bloqueada_por_dns";
      if (p.canRead && !pasoBloqueado) {
        corte = __pageThrough(p.line, __corte(full, paso.before, paso.command), paso.before, paso.command, p.device);
        output = corte.texto;
        if (siguiente && corte.motivo === "prefijo" && paso.before.length > 0) {
          var antes = __texto(paso.before);
          var despues = __texto(siguiente.before);
          if (despues.length > antes.length && despues.substring(0, antes.length) === antes) {
            var tope = despues.length - antes.length;
            if (output.length > tope) output = output.substring(0, tope);
          }
        }
        if (!corte.limpio) cortesDegradados++;
        if (output.length > maxChars) output = output.substring(output.length - maxChars);
      }

      // Sin ejecucion no hay "error" (el comando no llego a fallar: no llego a
      // teclearse) ni "ok": el contrato es "unknown" con la salida vacia, el
      // mismo veredicto que `runDeviceCommands` da en este caso. Para el resto
      // de `execError` (fallo al enviar) sigue siendo "error".
      var status = pasoBloqueado
        ? "unknown"
        : paso.execError
          ? "error"
          : __resolveStatus(paso.statusRaw, output);
      // Misma defensa que `runDeviceCommands`: un bloque de arranque en la salida
      // significa que el comando no llego a ejecutarse de verdad, asi que nunca
      // se reporta como "ok".
      if (__bloqueDeArranque(output)) {
        arranquePendiente++;
        if (status === "ok") status = "unknown";
      }

      var fila = { command: paso.command, status: status, output: output };
      // Motivo del corte SOLO cuando no fue limpio: en el caso normal la fila
      // conserva exactamente su forma (`command`/`status`/`output`).
      if (p.canRead && !corte.limpio) fila.corte = corte.motivo;
      // Motivo del `execError` SOLO cuando el paso no llego a ejecutarse: para
      // que el agente distinga "el comando no devuelve nada" de "no se pudo
      // teclear el comando" (consola bloqueada por DNS). Aditivo: en el camino
      // normal la fila no cambia de forma.
      if (paso.execError) fila.execError = paso.execError;
      results.push(fila);
    }

    var resumen = { total: results.length, ok: 0, errors: 0 };
    for (var r = 0; r < results.length; r++) {
      if (results[r].status === "ok") resumen.ok++;
      else resumen.errors++;
    }

    var payload = {
      success: true,
      pendienteId: id,
      done: true,
      estado: "terminado",
      fuente: p.done ? "commandEnded" : "buffer",
      pendienteMs: pendienteMs,
      deviceName: p.deviceName,
      results: results,
      summary: resumen,
    };
    // Diagnostico del evento: `eventoEn` < comandos enviados significa que el
    // `commandEnded` se atribuyo a un comando anterior del lote (el lote puede
    // necesitar otro `runCommandAsync` para completarse). Aditivo: no aparece en
    // el caso normal.
    if (p.done && p.eventoEn >= 0 && p.eventoEn < p.comandos.length) {
      payload.eventoEn = String(p.eventoEn);
    }
    if (porVigencia) payload.motivo = "presupuesto_vencido";
    if (!p.canRead) payload.warning = "console_output_unavailable";
    if (arranquePendiente > 0) payload.arranque_pendiente = String(arranquePendiente);
    // Diagnostico de bloqueos de consola, con los valores ACUMULADOS del
    // pendiente (ver `__resolverBloqueo`). `comandoConsumido` tambien sale aqui:
    // el host puede haber reintentado ya y aun asi conviene que quede escrito que
    // el prompt se comio el primer envio. Aditivo, no aparece si no paso nada.
    if (p.bloqueoResuelto) payload.bloqueoResuelto = p.bloqueoResuelto;
    if (p.comandoConsumido) payload.comandoConsumido = true;
    if (bloqueoAgotado) payload.bloqueoAgotado = true;
    // Espera por el fin de escritura de PT: si llego a aplicarse y, si no, por
    // que se salto (`no_ios` en un PC/Server/Laptop, `host_no_lo_pidio`,
    // `sin_lectura`). Importa sobre todo con `fuente:"buffer"`: es lo que dice si
    // los `output` estan completos o se leyeron a mitad de escribir. Aditivo: el
    // motivo solo aparece cuando la espera NO se aplico.
    payload.esperaFinAplicada = esperaFinAplicada;
    if (esperaFinMotivo !== "aplicada") payload.esperaFinMotivo = esperaFinMotivo;
    // `via` de desbloqueo del PROPIO pendiente (no la global, ver `en_curso`) y si
    // se pudo suscribir `moreDisplayed`.
    payload.enterVia = p.enterVia;
    payload.pagerVia = p.pagerVia;
    payload.pagerRegistrado = p.pagerRegistrado === true;
    if (cortesDegradados > 0) {
      payload.corte = "degradado";
      payload.salida_recortada = String(cortesDegradados);
    }

    // Cierre: se desregistra el evento y se borra la entrada del mapa. Preguntar
    // otra vez por este id devuelve "pendiente desconocido o ya cerrado".
    __cerrarPendiente(id);
    return payload;
  } catch (error) {
    return fail("Error polling async commands", error);
  }
};

// ---------------------------------------------------------------------------
// Lectura de la consola sin ejecutar nada (los ultimos N lineas de getOutput).
// ---------------------------------------------------------------------------
readDeviceConsole = function (deviceName, lines) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: `Device ${deviceName} not found` };
    }

    var line = __resolveLine(device);
    if (!line || line.getOutput === undefined) {
      return {
        success: true,
        deviceName: deviceName,
        output: "",
        warning: "console_output_unavailable",
      };
    }

    var cap = 40;
    if (typeof lines === "number" && lines > 0) cap = Math.min(Math.floor(lines), 5000);

    var full = String(line.getOutput() || "");
    var parts = full.split("\n");
    var start = parts.length > cap ? parts.length - cap : 0;
    var slice = [];
    for (var i = start; i < parts.length; i++) slice.push(parts[i]);

    return { success: true, deviceName: deviceName, output: slice.join("\n") };
  } catch (error) {
    return fail("Error reading device console", error);
  }
};

getNetwork = function () {
  try {
    var deviceCount = ipc.network().getDeviceCount();
    var devices = [];
    var connections = [];

    var unresolvedLinks = 0;
    var nullPortLinks = 0;
    var linkCount = ipc.network().getLinkCount();

    // Pass 1: resolver los extremos de cada enlace con el dueno real del puerto
    // y marcar in_use por clave "equipo::puerto" (los nombres de interfaz se
    // repiten entre equipos, no valen como clave).
    var inUseSet = {};
    var resolvedLinks = [];
    for (var li = 0; li < linkCount; li++) {
      var link = ipc.network().getLinkAt(li);
      if (!link) {
        // enlace corrupto: no tiene extremos que resolver
        nullPortLinks++;
        continue;
      }
      var p1 = link.getPort1();
      var p2 = link.getPort2();
      if (!p1 || !p2) {
        // algun extremo sin puerto: enlace incompleto
        nullPortLinks++;
        continue;
      }

      var owner1 = __portDeviceName(p1);
      var owner2 = __portDeviceName(p2);
      if (!owner1 || !owner2) {
        // sin dueno resuelto no inventamos el enlace
        unresolvedLinks++;
        continue;
      }

      var port1Name = String(p1.getName());
      var port2Name = String(p2.getName());
      inUseSet[owner1 + "::" + port1Name] = true;
      inUseSet[owner2 + "::" + port2Name] = true;
      resolvedLinks.push({
        link: link,
        from: owner1,
        fromInterface: port1Name,
        to: owner2,
        toInterface: port2Name,
      });
    }

    // Pass 2: devices + interfaces, con in_use calculado por equipo + puerto y
    // con el direccionamiento (ipAddress/subnetMask/gateway/dhcpEnabled) que
    // PT exponga. Solo se ANADEN campos nuevos: name/model/type/interfaces y
    // la forma del payload no cambian (los consumidores ignoran lo que no
    // reconozcan, pero los que SI esperan ips ya las encuentran).
    for (var i = 0; i < deviceCount; i++) {
      var device = ipc.network().getDeviceAt(i);
      var deviceName = device.getName();
      var typeEq = device.getType();

      var interfaces = [];
      var ips = [];
      var mascara = "";
      var gateway = "";
      var dhcp = null;
      var portCount = device.getPortCount();
      for (var j = 0; j < portCount; j++) {
        var port = device.getPortAt(j);
        if (port) {
          var pname = port.getName();
          var interfaz = {
            name: pname,
            in_use: inUseSet[deviceName + "::" + pname] === true,
          };

          var ipPuerto = __dirUtil(__valorDir(port, DIR_IP));
          if (ipPuerto) {
            interfaz.ipAddress = ipPuerto;
            if (ips.indexOf(ipPuerto) === -1) ips.push(ipPuerto);
            var maskPuerto = __dirUtil(__valorDir(port, DIR_MASCARA));
            if (maskPuerto) {
              interfaz.subnetMask = maskPuerto;
              if (!mascara) mascara = maskPuerto;
            }
            var gwPuerto = __dirUtil(__valorDir(port, DIR_GATEWAY));
            if (gwPuerto) {
              interfaz.gateway = gwPuerto;
              if (!gateway) gateway = gwPuerto;
            }
          }
          if (dhcp === null) dhcp = __dhcpDe(port);
          interfaces.push(interfaz);
        }
      }

      // Direccionamiento a nivel de equipo: primero la propia API del device,
      // luego `ipConfiguration`/`ipConfig` si PT los expone como propiedades
      // (mismos nombres de campo que busca `direccionamientoDe` en Tool.ts).
      var ipDev = __dirUtil(__valorDir(device, DIR_IP));
      if (ipDev && ips.indexOf(ipDev) === -1) ips.push(ipDev);
      if (!mascara) mascara = __dirUtil(__valorDir(device, DIR_MASCARA));
      if (!gateway) gateway = __dirUtil(__valorDir(device, DIR_GATEWAY));

      var objDir = null;
      try {
        objDir = device.ipConfiguration || device.ipConfig || null;
      } catch (eDirEquipo) {
        objDir = null;
      }
      if (objDir) {
        var ipEq = __dirUtil(__valorDir(objDir, DIR_IP));
        if (ipEq && ips.indexOf(ipEq) === -1) ips.push(ipEq);
        var maskEq = __dirUtil(__valorDir(objDir, DIR_MASCARA));
        if (maskEq && !mascara) mascara = maskEq;
        var gwEq = __dirUtil(__valorDir(objDir, DIR_GATEWAY));
        if (gwEq && !gateway) gateway = gwEq;
        if (dhcp === null) dhcp = __dhcpDe(objDir);
      }
      if (dhcp === null) dhcp = __dhcpDe(device);

      // Fallback al xml de PT: si por API no hay NINGUNA direccion, o si es un
      // host y no hay gateway (el backend lo exige para hosts y el informe de
      // direccionamiento no debe acusar "sin gateway" cuando PT lo tiene).
      // serializeToXml es caro, asi que solo se recurre a el en esos casos.
      if (!ips.length || (!gateway && __isHostType(typeEq))) {
        var xmlDir = "";
        try {
          xmlDir = String(device.serializeToXml() || "");
        } catch (eXmlDir) {
          xmlDir = "";
        }
        var dirXml = __dirDesdeXmlPuertos(xmlDir);
        var consumidos = {};
        for (var xi = 0; xi < interfaces.length; xi++) {
          var datoX = dirXml.porNombre[interfaces[xi].name];
          if (!datoX) continue;
          consumidos[interfaces[xi].name] = true;
          if (!interfaces[xi].ipAddress && datoX.ip) {
            interfaces[xi].ipAddress = datoX.ip;
          }
          if (datoX.ip && ips.indexOf(datoX.ip) === -1) ips.push(datoX.ip);
          if (datoX.mascara && !interfaces[xi].subnetMask) {
            interfaces[xi].subnetMask = datoX.mascara;
          }
          if (datoX.mascara && !mascara) mascara = datoX.mascara;
          if (datoX.gateway && !interfaces[xi].gateway) {
            interfaces[xi].gateway = datoX.gateway;
          }
          if (datoX.gateway && !gateway) gateway = datoX.gateway;
        }
        // Puertos del xml que no cascan con ninguna interfaz conocida: el dato
        // es bueno y se deja a nivel de equipo (el backend lee `ips` y
        // `ipAddress` tambien en el propio dispositivo).
        for (var claveX in dirXml.porNombre) {
          if (!Object.prototype.hasOwnProperty.call(dirXml.porNombre, claveX)) continue;
          if (consumidos[claveX]) continue;
          var datoNo = dirXml.porNombre[claveX];
          if (ips.indexOf(datoNo.ip) === -1) ips.push(datoNo.ip);
          if (datoNo.mascara && !mascara) mascara = datoNo.mascara;
          if (datoNo.gateway && !gateway) gateway = datoNo.gateway;
        }
        for (var xs = 0; xs < dirXml.sueltos.length; xs++) {
          var suelto = dirXml.sueltos[xs];
          if (ips.indexOf(suelto.ip) === -1) ips.push(suelto.ip);
          if (suelto.mascara && !mascara) mascara = suelto.mascara;
          if (suelto.gateway && !gateway) gateway = suelto.gateway;
        }
      }

      var equipo = {
        name: deviceName,
        model: device.getModel(),
        type: typeEq,
        interfaces: interfaces,
      };
      if (ips.length) {
        equipo.ipAddress = ips[0];
        equipo.ips = ips;
      }
      if (mascara) equipo.subnetMask = mascara;
      if (gateway) equipo.gateway = gateway;
      if (dhcp !== null) equipo.dhcpEnabled = dhcp;
      devices.push(equipo);
    }

    // Pass 3: conexiones ya resueltas en Pass 1 (extremos verificados).
    for (var k = 0; k < resolvedLinks.length; k++) {
      var resolved = resolvedLinks[k];
      connections.push({
        from: resolved.from,
        fromInterface: resolved.fromInterface,
        to: resolved.to,
        toInterface: resolved.toInterface,
        type: resolved.link.getConnectionType(),
      });
    }

    return {
      success: true,
      result: {
        deviceCount: devices.length,
        connectionCount: connections.length,
        devices: devices,
        connections: connections,
        unresolvedLinks: unresolvedLinks,
        nullPortLinks: nullPortLinks,
      },
    };
  } catch (error) {
    return fail("", error);
  }
};

getDeviceInfo = function (deviceName) {
  try {
    var net = getNetwork();
    if (!net || !net.success) {
      return net || { success: false, error: "getNetwork failed" };
    }
    var devices = net.result.devices;
    var connections = net.result.connections;
    for (var i = 0; i < devices.length; i++) {
      if (devices[i].name === deviceName) {
        var related = [];
        for (var j = 0; j < connections.length; j++) {
          var c = connections[j];
          if (c.from === deviceName || c.to === deviceName) related.push(c);
        }
        return {
          success: true,
          result: {
            device: devices[i],
            connections: related,
          },
        };
      }
    }
    return {
      success: false,
      error: `Device ${deviceName} not found`,
    };
  } catch (error) {
    return fail("Error getting device info", error);
  }
};

removeDevice = function (deviceNames) {
  try {
    var devicesToRemove = [];
    if (typeof deviceNames === "string") {
      devicesToRemove = [deviceNames];
    } else if (Array.isArray(deviceNames)) {
      devicesToRemove = deviceNames;
    } else {
      return {
        success: false,
        error:
          "Invalid input: provide a device name string or array of device names",
      };
    }

    var workspace = ipc.appWindow().getActiveWorkspace().getLogicalWorkspace();
    var results = [];
    var successCount = 0;
    var failCount = 0;

    for (var i = 0; i < devicesToRemove.length; i++) {
      var deviceName = devicesToRemove[i];
      var device = ipc.network().getDevice(deviceName);

      if (!device) {
        results.push({
          device: deviceName,
          success: false,
          error: "Device not found",
        });
        failCount++;
      } else {
        var result = workspace.removeDevice(deviceName);

        if (result === true) {
          results.push({
            device: deviceName,
            success: true,
            message: "Removed successfully",
          });
          successCount++;
        } else {
          results.push({
            device: deviceName,
            success: false,
            error: "Failed to remove",
          });
          failCount++;
        }
      }
    }

    return {
      success: failCount === 0,
      totalDevices: devicesToRemove.length,
      successCount: successCount,
      failCount: failCount,
      results: results,
    };
  } catch (error) {
    return fail("Error removing devices", error);
  }
};

// ---------------------------------------------------------------------------
// MODO DE SIMULACION
//
// MEDIDO en PT 9: `sim.setSimulationMode(bool)` LANZA siempre ("Simulation -
// Invalid arguments for IPC call"), con las tres variantes del nombre del
// argumento. La via que SI funciona es el conmutador de la ventana principal:
// `ipc.appWindow().getRSSwitch().showSimulationMode()` / `showRealtimeMode()`.
//
// `setSimulationMode` es una tool expuesta y estaba ROTA, asi que se arregla:
// primero el conmutador de la ventana y, si no existe, la API del objeto de
// simulacion como respaldo. Si ambas fallan, el error lo DICE (no es un "error
// generico" que el agente no puede accionable).
//
// Tambien es la pieza que usa el ping por PDU (vía `__irASimulacion`), porque
// MEDIDO (`scripts/pt-diag-pduping.ts`): en tiempo real el PDU no genera frames
// y el ping necesita simular para poder medir.
// ---------------------------------------------------------------------------

// Entra (`activo` true) o SALE (`activo` false) del modo simulacion. Es la
// ENVOLTORIA del ping por PDU: delega en `setSimulationMode`, que es la unica
// funcion que conoce la via que funciona en PT 9 (el conmutador de la ventana,
// con la API del objeto de simulacion como respaldo), para no duplicar esa
// conmutacion en dos sitios.
//
// MEDIDO (`packages/server/scripts/pt-diag-pduping.ts`): en modo REAL el PDU no
// genera ni un frame aunque se llame a `forward()`, asi que el ping por PDU
// NECESITA entrar en simulacion antes de crear el PDU y salir al terminar,
// devolviendo PT al modo que tenia.
//
// Devuelve {ok, via, motivo}: `ok:true` tambien cuando ya estaba en el modo
// pedido (`via:"sin_cambio"`), porque entrar dos veces no puede fallar un ping.
function __irASimulacion(activo) {
  var objetivo = activo !== false;
  var nombreObjetivo = objetivo ? "simulation" : "realtime";

  var sim = null;
  try {
    sim = ipc.simulation();
  } catch (eSim) {
    return {
      ok: false,
      via: "ninguna",
      motivo: "Packet Tracer no expone el objeto de simulacion.",
    };
  }

  // Modo real actual: si ya estamos en el objetivo no hay nada que conmutar.
  var actual = "";
  try {
    actual = sim.isSimulationMode() ? "simulation" : "realtime";
  } catch (eM) {
    actual = "";
  }
  if (actual === nombreObjetivo) {
    return { ok: true, via: "sin_cambio", motivo: "" };
  }

  var cambio = setSimulationMode(objetivo);
  if (cambio && cambio.success === true) {
    return { ok: true, via: cambio.via || "rsswitch", motivo: "" };
  }
  return {
    ok: false,
    via: (cambio && cambio.via) || "ninguna",
    motivo: __mensajeDeError(
      (cambio && cambio.error) ||
        "no se pudo conmutar al modo " + nombreObjetivo + " de Packet Tracer."
    ),
  };
}

// Conmutador de modo de la ventana principal, o null si PT no lo expone.
function __rsswitch() {
  try {
    if (ipc === undefined || ipc === null) return null;
    if (typeof ipc.appWindow !== "function") return null;
    var app = ipc.appWindow();
    if (!app || typeof app.getRSSwitch !== "function") return null;
    return app.getRSSwitch() || null;
  } catch (e) {
    return null;
  }
}

setSimulationMode = function (toSimMode) {
  try {
    var objetivo = !!toSimMode;
    var nombreObjetivo = objetivo ? "simulation" : "realtime";
    var sim = ipc.simulation();

    // Modo real actual (fuente de verdad: la API de simulacion).
    var actual = null;
    try {
      actual = sim.isSimulationMode() ? "simulation" : "realtime";
    } catch (eModo) {
      actual = null;
    }
    if (actual === nombreObjetivo) {
      return {
        success: true,
        message: "Already in " + nombreObjetivo + " mode",
        mode: nombreObjetivo,
        via: "sin_cambio",
        modoAnterior: actual,
      };
    }

    // 1) Conmutador de la ventana (la unica via que funciona en PT 9).
    var sw = __rsswitch();
    var metodo = objetivo ? "showSimulationMode" : "showRealtimeMode";
    if (sw && typeof sw[metodo] === "function") {
      sw[metodo]();
      return {
        success: true,
        message: "Switched to " + nombreObjetivo + " mode",
        mode: nombreObjetivo,
        via: "rsswitch",
        modoAnterior: actual,
      };
    }

    // 2) Respaldo: la API del objeto de simulacion (rompe en PT 9, por eso va
    //    dentro de su propio try/catch para poder decir POR QUE fallo).
    try {
      sim.setSimulationMode(objetivo);
      return {
        success: true,
        message: "Switched to " + nombreObjetivo + " mode",
        mode: nombreObjetivo,
        via: "simulacion",
        modoAnterior: actual,
      };
    } catch (eSim) {
      return {
        success: false,
        error:
          "Packet Tracer 9 rechaza el argumento booleano de 'setSimulationMode' " +
          "(IPC: Invalid arguments for IPC call) y su conmutador de ventana " +
          "('" + metodo + "') no esta disponible: no se puede cambiar de modo " +
          "por API. El ping por PDU lo necesita (en tiempo real el PDU no " +
          "genera frames), asi que medira por la via de consola.",
        modoAnterior: actual,
        via: "ninguna",
      };
    }
  } catch (error) {
    return fail("Error setting simulation mode", error);
  }
};

getSimulationStatus = function () {
  try {
    var sim = ipc.simulation();

    // Fuente de verdad del modo: `sim.isSimulationMode()`. Antes se derivaba de
    // otro sitio y no coincidia con lo que PT hacia de verdad.
    var esSimulacion = false;
    var leido = true;
    try {
      esSimulacion = !!sim.isSimulationMode();
    } catch (eIs) {
      leido = false;
    }

    var result = { mode: esSimulacion ? "simulation" : "realtime" };
    if (!leido) result.modoDesconocido = true;

    // Los contadores se intentan siempre (tambien valen en tiempo real: el PDU
    // avanza con `forward()`), y cada lectura va envuelta porque PT 9 no expone
    // todos los getters.
    try {
      if (typeof sim.getCurrentSimTime === "function") {
        result.currentTime = sim.getCurrentSimTime();
      }
    } catch (eT) {
      // sin reloj de simulacion: el resto de contadores siguen valiendo
    }
    try {
      if (typeof sim.getFrameInstanceCount === "function") {
        result.frameCount = sim.getFrameInstanceCount();
      }
    } catch (eC) {
      // sin contador de frames
    }
    try {
      if (typeof sim.getCurrentFrameInstanceIndex === "function") {
        result.currentFrameIndex = sim.getCurrentFrameInstanceIndex();
      }
    } catch (eI) {
      // sin indice de frame actual
    }

    // El conmutador de la ventana solo se reporta como dato adicional (da igual
    // que no exista).
    result.conmutadorVentana = __rsswitch() ? "disponible" : "no_disponible";

    return { success: true, result: result };
  } catch (error) {
    return fail("Error getting simulation status", error);
  }
};

stepSimulation = function (direction, steps) {
  try {
    var sim = ipc.simulation();
    if (!sim.isSimulationMode()) {
      return {
        success: false,
        error: "Not in simulation mode. Call setSimulationMode(true) first.",
      };
    }
    if (direction === "reset") {
      sim.resetSimulation();
      return { success: true, message: "Simulation reset" };
    }
    var n = steps && steps >= 1 ? Math.min(steps, 100) : 1;
    for (var i = 0; i < n; i++) {
      if (direction === "forward") {
        sim.forward();
      } else if (direction === "backward") {
        sim.backward();
      } else {
        return { success: false, error: "Unknown direction: " + direction };
      }
    }
    return {
      success: true,
      message: direction + " " + n + " step(s)",
      currentTime: sim.getCurrentSimTime(),
      frameCount: sim.getFrameInstanceCount(),
    };
  } catch (error) {
    return fail("Error stepping simulation", error);
  }
};

sendPdu = function (sourceDevice, destinationDevice) {
  try {
    var sim = ipc.simulation();
    var modeEnabled = false;
    if (!sim.isSimulationMode()) {
      // MEDIDO: `sim.setSimulationMode(true)` LANZA en PT 9, asi que se delega
      // en setSimulationMode (que usa el conmutador de la ventana). Y como en
      // tiempo real el PDU no genera frames, que el modo no cambie NO invalida
      // el envio aqui (el PDU se queda pendiente hasta que el usuario simule):
      // se avisa en el payload en vez de abortar.
      var cambio = setSimulationMode(true);
      modeEnabled = !!(cambio && cambio.success);
    }
    if (!ipc.network().getDevice(sourceDevice)) {
      return { success: false, error: "Source device not found: " + sourceDevice };
    }
    if (!ipc.network().getDevice(destinationDevice)) {
      return { success: false, error: "Destination device not found: " + destinationDevice };
    }
    var errCode = ipc.appWindow().getUserCreatedPDU().addSimplePdu(sourceDevice, destinationDevice);
    // ADD_PDU_ERROR: 0 / falsy = success
    var errStr = String(errCode);
    if (errCode && errStr !== "0") {
      return { success: false, error: "PT rejected PDU (ADD_PDU_ERROR=" + errStr + ")" };
    }
    return {
      success: true,
      message: "ICMP PDU added from " + sourceDevice + " to " + destinationDevice,
      simulationModeEnabled: modeEnabled,
    };
  } catch (error) {
    return fail("Error sending PDU", error);
  }
};

renameDevice = function (deviceName, newName) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: "Device not found: " + deviceName };
    }
    device.setName(newName);
    return { success: true, message: "Renamed " + deviceName + " to " + newName };
  } catch (error) {
    return fail("Error renaming device", error);
  }
};

moveDevice = function (deviceName, x, y) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: "Device not found: " + deviceName };
    }
    device.moveToLocation(x, y);
    return {
      success: true,
      message: "Moved " + deviceName + " to (" + x + ", " + y + ")",
    };
  } catch (error) {
    return fail("Error moving device", error);
  }
};

// Maps both numeric and C++ enum-string forms of eTrafficType to readable names.
// PT's JS host may expose the enum as "0" or as "eTrafficType_Icmp" -- handle both.
var TRAFFIC_TYPE_NAMES = {
  "0": "ICMP",  "eTrafficType_Icmp": "ICMP",
  "1": "TCP",   "eTrafficType_Tcp": "TCP",
  "2": "UDP",   "eTrafficType_Udp": "UDP",
  "3": "RIPv1", "eTrafficType_RipV1": "RIPv1",
  "4": "RIPv2", "eTrafficType_RipV2": "RIPv2",
  "5": "ARP",   "eTrafficType_Arp": "ARP",
  "6": "CDP",   "eTrafficType_Cdp": "CDP",
  "7": "DHCP",  "eTrafficType_Dhcp": "DHCP",
  "11": "STP",  "eTrafficType_Stp": "STP",
  "12": "OSPF", "eTrafficType_Ospf": "OSPF",
  "13": "DTP",  "eTrafficType_Dtp": "DTP",
  "17": "HTTP", "eTrafficType_Http": "HTTP",
  "18": "HTTPS","eTrafficType_Https": "HTTPS",
  "19": "DNS",  "eTrafficType_Dns": "DNS",
  "36": "BGP",  "eTrafficType_Bgp": "BGP",
  "1000": "Custom", "eTrafficType_Custom": "Custom",
};

// Tope por defecto de frames que devuelve getPduResults. Antes no habia tope
// util en el codigo pero el consumidor practico acababa viendo 6 frames, asi
// que el recorte se hace aqui, de forma explicita y CONFIGURABLE por
// `options.limit`.
var PDU_RESULTADOS_LIMITE = 50;

// Estado de un frame segun la API oficial (`class_frame_instance-members`):
// `accepted` = entregado, `dropped` / `not_forwarded` / `unexpected` = el frame
// murio por el camino. El orden importa: se evalua lo mas concluyente primero.
function __estadoFrame(fi) {
  if (fi.isFrameAccepted()) return "accepted";
  if (fi.isFrameDropped()) return "dropped";
  if (fi.isFrameNotForwarded()) return "not_forwarded";
  if (fi.isFrameUnexpected()) return "unexpected";
  if (fi.isFrameCollidedOnLink() || fi.isFrameCollidedAtDevice()) return "collision";
  if (fi.isFrameBuffered()) return "buffered";
  if (fi.isFrameOnTransit()) return "in_transit";
  if (fi.isFrameSent()) return "sent";
  return "unknown";
}

// Filtro de tipos de trafico -> mapa en mayusculas, o null (sin filtro).
function __filtroTipos(types) {
  if (!Array.isArray(types) || types.length === 0) return null;
  var filtro = {};
  for (var t = 0; t < types.length; t++) filtro[String(types[t]).toUpperCase()] = true;
  return filtro;
}

// Un frame del payload. `source`/`destination` se copian TAL QUALI los da PT:
// MEDIDO en PT 9 ambos vienen VACIOS, y no se inventan nombres: los frames se
// identifican por `index` (ver *PING POR PDU* en el README).
function __frameAPayload(fi, indice, tipoNombre) {
  var frame = {
    index: indice,
    source: "",
    destination: "",
    trafficType: tipoNombre,
    status: "unknown",
  };
  try {
    var s = fi.getSourceString();
    if (s) frame.source = String(s);
  } catch (eS) {
    // PT 9 lo deja vacio: se queda ""
  }
  try {
    var d = fi.getDestinationString();
    if (d) frame.destination = String(d);
  } catch (eD) {
    // PT 9 lo deja vacio: se queda ""
  }
  try {
    frame.status = __estadoFrame(fi);
  } catch (eSt) {
    // getters de estado no disponibles: "unknown"
  }
  // `device` y `transitTime` son ADITIVOS: solo si PT los da y son utilizables.
  try {
    if (typeof fi.getDevice === "function") {
      var dev = fi.getDevice();
      if (dev) {
        var nombre = "";
        if (typeof dev.getName === "function") nombre = String(dev.getName());
        if (nombre) frame.device = nombre;
      }
    }
  } catch (eDev) {
    // sin getDevice(): el frame se identifica por indice
  }
  try {
    if (typeof fi.getTransitTime === "function") {
      var tt = fi.getTransitTime();
      if (typeof tt === "number" && isFinite(tt) && tt >= 0) frame.transitTime = tt;
    }
  } catch (eTt) {
    // sin tiempo de transito: se calcula con el reloj de simulacion
  }
  return frame;
}

// Lectura cruda del rango de frames [desde, hasta) del escenario, con filtro de
// tipo y tope. Es la base de getPduResults (con `sinceIndex`) y del ping por PDU
// (que aisla los frames de su propio PDU con el indice previo).
function __framesDeRango(sim, desde, hasta, filtro, limite) {
  var total = 0;
  var encontrados = 0;
  var frames = [];
  for (var i = desde; i < hasta; i++) {
    var fi = null;
    try {
      fi = sim.getFrameInstanceAt(i);
    } catch (eFrame) {
      fi = null;
    }
    if (!fi) continue;
    var rawType = "";
    try {
      rawType = String(fi.getUserTrafficType());
    } catch (eT) {
      continue;
    }
    var typeName = TRAFFIC_TYPE_NAMES[rawType] || rawType;
    if (filtro && !filtro[typeName.toUpperCase()]) continue;
    encontrados++;
    if (frames.length < limite) frames.push(__frameAPayload(fi, i, typeName));
  }
  return { frames: frames, encontrados: encontrados };
}

// Filtra una lectura de frames por los DISPOSITIVOS de nuestra pareja (origen y
// destino).
//
// POR QUE (medido, `packages/server/scripts/pt-diag-pduping.ts`): los PDUs de
// pings anteriores siguen PENDIENTES en el escenario y avanzan con los
// `forward()` de este ping, asi que el rango `index >= antes` puede traer frames
// de un PDU VIEJO: el primer intento leyo 34 frames y dio el veredicto contra
// uno descartado en un equipo que no era el de esta pareja. Como
// `getSourceString()` / `getDestinationString()` vienen VACIOS en PT 9, el unico
// dato fiable para atribuir un frame es `getDevice()`.
//
// Si NINGUN frame de la lectura trae `device`, esa API no es utilizable: no se
// puede atribuir nada, asi que se devuelve el rango ENTERO y se marca
// `porDispositivo:false` para que el ping lo diga en su payload. Los frames que
// quedan fuera NO deciden el veredicto (solo se cuentan), porque son
// precisamente los que contaminan la medicion.
function __framesDePareja(lectura, origen, destino) {
  var lista = (lectura && lectura.frames) || [];
  var i = 0;
  var conNombre = 0;
  for (i = 0; i < lista.length; i++) {
    if (lista[i] && lista[i].device) conNombre++;
  }
  if (conNombre === 0) {
    return {
      frames: lista,
      descartados: 0,
      porDispositivo: false,
      negativosAjenos: 0,
    };
  }
  var dentro = [];
  var fuera = 0;
  var negativos = 0;
  for (i = 0; i < lista.length; i++) {
    var f = lista[i] || {};
    var nombre = f.device ? String(f.device) : "";
    if (nombre === String(origen) || nombre === String(destino)) {
      dentro.push(f);
      continue;
    }
    fuera++;
    if (
      f.status === "dropped" ||
      f.status === "not_forwarded" ||
      f.status === "unexpected" ||
      f.status === "collision"
    ) {
      negativos++;
    }
  }
  return {
    frames: dentro,
    descartados: fuera,
    porDispositivo: true,
    negativosAjenos: negativos,
  };
}

// Lectura del historial de PDUs del escenario.
//
// `types`  = filtro de trafico ya existente (array) -- por compatibilidad tambien
//            admite un string suelto ("ICMP").
// `options` = {limit, sinceIndex | sinceFrameCount} (aditivo). `sinceIndex` es
//            lo que usa el ping por PDU para quedarse con SUS frames.
//
// `sinceIndex` tambien se puede pasar como primer argumento en forma de objeto
// (`getPduResults({types:["ICMP"], sinceIndex: n})`) porque TOOL_ARGS solo
// reenvia un argumento posicional: asi las opciones nuevas son usables desde el
// backend sin tocar `interface/interface.js`.
getPduResults = function (types, options) {
  try {
    var opts = {};
    if (types && !Array.isArray(types) && typeof types === "object") {
      opts = types; // llamada con objeto de opciones
    } else if (Array.isArray(types)) {
      opts.types = types; // llamada clasica: getPduResults(["ICMP"])
    } else if (typeof types === "string" && types) {
      opts.types = [types];
    }
    if (options && typeof options === "object") {
      for (var k in options) {
        if (Object.prototype.hasOwnProperty.call(options, k)) opts[k] = options[k];
      }
    }

    var filtro = __filtroTipos(opts.types);

    var limite = PDU_RESULTADOS_LIMITE;
    if (typeof opts.limit === "number" && opts.limit > 0) {
      limite = Math.min(Math.floor(opts.limit), 500);
    }

    var desde = 0;
    var desdeRaw = opts.sinceIndex;
    if (desdeRaw === undefined || desdeRaw === null) desdeRaw = opts.sinceFrameCount;
    if (typeof desdeRaw === "number" && desdeRaw > 0) desde = Math.floor(desdeRaw);

    var sim = ipc.simulation();

    // Los frames se leen con o sin modo simulacion (el historial es el mismo),
    // asi que el modo no es un requisito de ESTA lectura: se reporta igualmente
    // como dato. Ojo: leer no es medir. MEDIDO, en tiempo real el PDU no genera
    // frames aunque se llame a `forward()`; medir exige modo simulacion, que es
    // lo que hace por su cuenta `pduPing`.
    var modo = "realtime";
    try {
      modo = sim.isSimulationMode() ? "simulation" : "realtime";
    } catch (eM) {
      // si ni el modo se puede leer, se sigue con la lectura
    }

    var total = 0;
    try {
      total = Number(sim.getFrameInstanceCount()) || 0;
    } catch (eC) {
      return {
        success: true,
        result: {
          totalFrames: 0,
          sinceIndex: desde,
          limit: limite,
          shown: 0,
          truncated: false,
          frames: [],
          modo: modo,
          aviso: "Packet Tracer no expone el historial de frames de este escenario",
        },
      };
    }

    var lectura = __framesDeRango(sim, desde, total, filtro, limite);
    return {
      success: true,
      result: {
        totalFrames: total,
        sinceIndex: desde,
        limit: limite,
        shown: lectura.frames.length,
        truncated: lectura.encontrados > lectura.frames.length,
        frames: lectura.frames,
        modo: modo,
      },
    };
  } catch (error) {
    return fail("Error getting PDU results", error);
  }
};

getCommandLog = function (deviceName, limit) {
  try {
    var log = ipc.commandLog();
    var total = log.getEntryCount();
    var cap = limit && limit > 0 ? Math.min(limit, 500) : 50;
    var entries = [];

    for (var i = total - 1; i >= 0 && entries.length < cap; i--) {
      var entry = log.getEntryAt(i);
      if (!entry) continue;
      var dev = entry.getDeviceName();
      if (deviceName && dev !== deviceName) continue;
      entries.push({
        timestamp: entry.getTimeToString(),
        device: dev,
        prompt: entry.getPrompt(),
        command: entry.getCommand(),
        resolvedCommand: entry.getResolvedCommand(),
      });
    }

    return {
      success: true,
      result: { totalEntries: total, returned: entries.length, entries: entries },
    };
  } catch (error) {
    return fail("Error getting command log", error);
  }
};

setPower = function (deviceName, power) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: "Device not found: " + deviceName };
    }
    device.setPower(power);
    return {
      success: true,
      message: deviceName + " powered " + (power ? "on" : "off"),
    };
  } catch (error) {
    return fail("Error setting device power", error);
  }
};

removeLink = function (links) {
  try {
    var linksToRemove = [];

    if (typeof links === "object" && links !== null && !Array.isArray(links)) {
      linksToRemove = [links];
    } else if (Array.isArray(links)) {
      linksToRemove = links;
    } else {
      return {
        success: false,
        error:
          "Invalid input: provide link object {device, port} or array of link objects",
      };
    }

    var workspace = ipc.appWindow().getActiveWorkspace().getLogicalWorkspace();
    var results = [];
    var successCount = 0;
    var failCount = 0;

    for (var i = 0; i < linksToRemove.length; i++) {
      var link = linksToRemove[i];
      var deviceName = link.device || link.deviceName;
      var portName = link.port || link.portName;

      if (!deviceName || !portName) {
        results.push({
          device: deviceName,
          port: portName,
          success: false,
          error: "Missing device or port",
        });
        failCount++;
        continue;
      }

      var device = ipc.network().getDevice(deviceName);
      if (!device) {
        results.push({
          device: deviceName,
          port: portName,
          success: false,
          error: "Device not found",
        });
        failCount++;
        continue;
      }

      var result = workspace.deleteLink(deviceName, portName);

      if (result === true) {
        results.push({
          device: deviceName,
          port: portName,
          success: true,
          message: "Link removed successfully",
        });
        successCount++;
      } else {
        results.push({
          device: deviceName,
          port: portName,
          success: false,
          error: "Failed to remove link",
        });
        failCount++;
      }
    }

    return {
      success: failCount === 0,
      totalLinks: linksToRemove.length,
      successCount: successCount,
      failCount: failCount,
      results: results,
    };
  } catch (error) {
    return fail("Error removing links", error);
  }
};

// ---------------------------------------------------------------------------
// Reescritura: configura un equipo IOS delegando en el motor de comandos.
// `commands` llega como string con saltos de linea.
//
// OJO: el backend ya no la llama. La tool `configureIosDevice` del agente hace
// su propio ciclo de consola (`runCommandAsync` + `pollCommandResult`) y no pasa
// por aqui, asi que su nombre salio de TOOL_ARGS en interface.js. Se conserva
// como respaldo manual, para teclearla desde la consola de Scripts de Packet
// Tracer, porque borra menos de lo que borra.
// ---------------------------------------------------------------------------
configureIosDevice = function (deviceName, commands) {
  try {
    var text =
      typeof commands === "string"
        ? commands
        : Array.isArray(commands)
          ? commands.join("\n")
          : commands === undefined || commands === null
            ? ""
            : String(commands);

    var raw = text.split("\n");
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i].replace(/\r$/, "").trim();
      if (line) lines.push(line);
    }

    var res = runDeviceCommands(deviceName, lines, { mode: "global" });
    if (!res || !res.success) return res;

    // Best-effort: persistimos la config si el equipo lo soporta.
    var results = res.results.slice();
    var writeEntry = null;
    var w1 = runDeviceCommands(deviceName, ["write memory"], { mode: "enable" });
    if (w1 && w1.success && w1.results && w1.results.length && w1.results[0].status === "ok") {
      writeEntry = w1.results[0];
    } else {
      var w2 = runDeviceCommands(deviceName, ["do write memory"], { mode: "global" });
      if (w2 && w2.success && w2.results && w2.results.length) writeEntry = w2.results[0];
    }
    if (writeEntry) results.push(writeEntry);

    var summary = { total: results.length, ok: 0, errors: 0 };
    for (var r = 0; r < results.length; r++) {
      if (results[r].status === "ok") summary.ok++;
      else summary.errors++;
    }

    return {
      success: res.success,
      deviceName: deviceName,
      results: results,
      summary: summary,
    };
  } catch (error) {
    return fail("Error configuring IOS device", error);
  }
};

// ---------------------------------------------------------------------------
// Reescritura: presets de lectura sobre el motor de comandos.
// ---------------------------------------------------------------------------
getRoutingTable = function (deviceName) {
  try {
    var res = runDeviceCommands(deviceName, ["show ip route"], { mode: "enable" });
    if (!res || !res.success) return res;

    var first = res.results.length ? res.results[0] : null;
    var routingTable = {};
    routingTable["show ip route"] = first ? first.output : "";

    return {
      success: true,
      device: deviceName,
      routingTable: routingTable,
      status: first ? first.status : "ok",
    };
  } catch (error) {
    return fail("Error getting routing table", error);
  }
};

getVlanConfiguration = function (switchName) {
  try {
    var device = ipc.network().getDevice(switchName);
    if (!device) {
      return { success: false, error: "Switch not found: " + switchName };
    }

    var deviceType = device.getType();
    if (deviceType !== 1 && deviceType !== 16) {
      return { success: false, error: "Device is not a switch" };
    }

    var res = runDeviceCommands(switchName, ["show vlan brief"], { mode: "enable" });
    if (!res || !res.success) return res;

    var first = res.results.length ? res.results[0] : null;
    var output = first ? first.output : "";
    var vlans = [];
    var raw = output.split("\n");
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i].replace(/\r$/, "");
      if (line.trim()) vlans.push(line);
    }

    return {
      success: true,
      result: {
        device: switchName,
        vlans: vlans,
        output: output,
        status: first ? first.status : "ok",
      },
    };
  } catch (error) {
    return fail("Error getting VLAN configuration", error);
  }
};

getDeviceMetrics = function (deviceName) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: "Device not found: " + deviceName };
    }

    var metrics = {
      deviceName: deviceName,
      model: device.getModel(),
      type: device.getType(),
      powerState: device.getPower(),
      interfaceMetrics: [],
    };

    var portCount = device.getPortCount();
    for (var i = 0; i < portCount; i++) {
      var port = device.getPortAt(i);
      if (port) {
        metrics.interfaceMetrics.push({
          name: port.getName(),
          status: port.getStatus ? port.getStatus() : "unknown",
        });
      }
    }

    var res = runDeviceCommands(
      deviceName,
      ["show processes cpu", "show memory statistics"],
      { mode: "enable" }
    );

    var extendedMetrics = {};
    if (res && res.success) {
      for (var j = 0; j < res.results.length; j++) {
        extendedMetrics[res.results[j].command] = res.results[j].output;
      }
    }
    metrics.extendedMetrics = extendedMetrics;

    return {
      success: true,
      result: metrics,
    };
  } catch (error) {
    return fail("Error getting device metrics", error);
  }
};

// Tope de `maxChars` de las lecturas que decide este veredicto. POR QUE NO el
// default (8.000): `runDeviceCommands` recorta por COLA cuando el `output` supera
// `maxChars` (`output.substring(output.length - maxChars)`), y las lineas que este
// veredicto decide (`enable secret`, `service`, `ip ssh`, `line vty`) estan al
// PRINCIPIO del running-config. En cualquier config grande se perdian y el
// veredicto era "equipo inseguro" siendo seguro: una falsa alerta de seguridad que
// empuja al agente a "arreglar" un equipo que ya esta bien. 40.000 chars cubren un
// running-config completo de sobra y aun asi son un tope, no un `maxChars`
// infinito: el buffer de PT esta acotado (~8 KB) asi que en la practica nunca se
// llega, y cuando se llega el payload lo dice (`salidaRecortada`).
var SEGURIDAD_MAX_CHARS = 40000;

validateSecurityConfig = function (deviceName) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: "Device not found: " + deviceName };
    }

    var checks = {
      device: deviceName,
      passwordSet: false,
      sshEnabled: false,
      telnetDisabled: false,
      warnings: [],
      // Veredicto PARCIAL: la salida que se decidio llego JUSTO al tope de
      // `SEGURIDAD_MAX_CHARS` (la recorte de `runDeviceCommands` es por cola), asi
      // que puede faltar alguna linea decisiva y estas comprobaciones NO son de
      // fiar. `false` = se leyo la config entera (el caso normal).
      salidaRecortada: false,
    };

    // El recorte por cola se detecta aqui y no dentro de `runDeviceCommands`
    // porque el motor, al recortar, deja el `output` justo en el tope: un
    // `output` de longitud >= tope significa "esto estaba recortado".
    function __recortada(res) {
      if (!res || !res.results || !res.results.length) return false;
      var salida = res.results[0].output;
      return typeof salida === "string" && salida.length >= SEGURIDAD_MAX_CHARS;
    }

    var filterCmd = "show running-config | include enable|service|line vty";
    var res = runDeviceCommands(deviceName, [filterCmd], {
      mode: "enable",
      maxChars: SEGURIDAD_MAX_CHARS,
    });
    var output = res && res.success && res.results.length ? res.results[0].output : "";
    var firstStatus =
      res && res.success && res.results && res.results.length ? res.results[0].status : "error";
    if (__recortada(res)) checks.salidaRecortada = true;

    // Fallback: si PT no soporta el filtro con "| include" leemos la config entera.
    // Tambien con el tope holgado: es la lectura que decide el veredicto cuando el
    // filtro no existe, y con 8.000 chars por cola perdia justo las lineas de
    // `enable secret` / `ip ssh` / `line vty`.
    if (!output.trim() || firstStatus === "error") {
      var alt = runDeviceCommands(deviceName, ["show running-config"], {
        mode: "enable",
        maxChars: SEGURIDAD_MAX_CHARS,
      });
      if (alt && alt.success && alt.results.length && alt.results[0].output) {
        output = alt.results[0].output;
        // El veredicto sale de la lectura que se acaba de ganar: si ESA esta
        // recortada, el veredicto es parcial aunque la anterior no lo estuviera.
        checks.salidaRecortada = __recortada(alt);
      }
    }

    if (!output.trim()) {
      checks.warnings.push("Cannot verify security configuration");
      return { success: true, result: checks };
    }

    var low = output.toLowerCase();

    checks.passwordSet = /enable (secret|password)/.test(low);
    if (!checks.passwordSet) {
      checks.warnings.push("No enable secret password configured");
    }

    checks.sshEnabled = low.indexOf("transport input ssh") !== -1 || low.indexOf("ip ssh") !== -1;
    if (!checks.sshEnabled) {
      checks.warnings.push("SSH is not enabled");
    }

    checks.telnetDisabled = low.indexOf("transport input ssh") !== -1;
    if (!checks.telnetDisabled) {
      checks.warnings.push("Telnet still enabled on line vty");
    }

    return {
      success: true,
      result: checks,
    };
  } catch (error) {
    return fail("Error validating security", error);
  }
};

// ---------------------------------------------------------------------------
// Reescrituras: apagado/encendido de interfaz con modos IOS validos.
// durationSeconds se acepta por compatibilidad de firma (no hay timers sincronos).
// ---------------------------------------------------------------------------
simulateLinkFailure = function (deviceName, interfaceName, durationSeconds) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: "Device not found: " + deviceName };
    }
    if (device.getPort !== undefined && !device.getPort(interfaceName)) {
      return { success: false, error: "Interface not found: " + interfaceName };
    }

    return runDeviceCommands(
      deviceName,
      ["interface " + interfaceName, "shutdown"],
      { mode: "global" }
    );
  } catch (error) {
    return fail("Error simulating link failure", error);
  }
};

restoreLink = function (deviceName, interfaceName) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: "Device not found: " + deviceName };
    }
    if (device.getPort !== undefined && !device.getPort(interfaceName)) {
      return { success: false, error: "Interface not found: " + interfaceName };
    }

    return runDeviceCommands(
      deviceName,
      ["interface " + interfaceName, "no shutdown"],
      { mode: "global" }
    );
  } catch (error) {
    return fail("Error restoring link", error);
  }
};

// ---------------------------------------------------------------------------
// Validacion de topologia 100% en memoria sobre ipc.network().
// ---------------------------------------------------------------------------
validateTopology = function () {
  try {
    var net = ipc.network();
    var errors = [];
    var warnings = [];
    var orphans = [];
    var loops = [];
    var unresolvedLinks = 0;
    var nullPortLinks = 0;

    var deviceCount = net.getDeviceCount();
    var linkCount = net.getLinkCount();

    // --- Inventario de dispositivos y de sus puertos ---
    var devices = [];
    var deviceTypeByName = {};
    var devicePorts = {};
    for (var i = 0; i < deviceCount; i++) {
      var dv = net.getDeviceAt(i);
      if (!dv) continue;
      var dName = String(dv.getName());
      devices.push(dName);
      try {
        deviceTypeByName[dName] = dv.getType();
      } catch (eType) {
        deviceTypeByName[dName] = -1;
      }
      var ports = [];
      var pc = 0;
      try {
        pc = dv.getPortCount();
      } catch (ePc) {
        pc = 0;
      }
      for (var q = 0; q < pc; q++) {
        var prt = dv.getPortAt(q);
        if (!prt) continue;
        ports.push(prt);
      }
      devicePorts[dName] = ports;
    }

    // --- Grafo de enlaces + deteccion de duplicados / interfaces repetidas ---
    var adjacency = {};
    var portUse = {};
    var portPairUse = {};
    var linkedDevices = {};
    var edges = [];

    for (var k = 0; k < linkCount; k++) {
      var lnk = net.getLinkAt(k);
      if (!lnk) {
        // enlace corrupto: no tiene extremos que resolver
        nullPortLinks++;
        continue;
      }
      var p1 = lnk.getPort1();
      var p2 = lnk.getPort2();
      if (!p1 || !p2) {
        // algun extremo sin puerto: enlace incompleto
        nullPortLinks++;
        continue;
      }

      var n1 = String(p1.getName());
      var n2 = String(p2.getName());
      var owner1 = __portDeviceName(p1);
      var owner2 = __portDeviceName(p2);

      if (!owner1 || !owner2) {
        // Extremo sin dueno: no es un enlace real, no entra en duplicados ni
        // en el grafo; el extremo resuelto sigue contando como conectado.
        unresolvedLinks++;
        if (owner1) linkedDevices[owner1] = true;
        if (owner2) linkedDevices[owner2] = true;
        continue;
      }

      // Claves por equipo + puerto: los nombres de interfaz se repiten entre
      // equipos y por si solos producirian falsos positivos.
      var key1 = owner1 + "::" + n1;
      var key2 = owner2 + "::" + n2;

      portUse[key1] = (portUse[key1] || 0) + 1;
      portUse[key2] = (portUse[key2] || 0) + 1;

      var pairKey = key1 < key2 ? key1 + "|" + key2 : key2 + "|" + key1;
      portPairUse[pairKey] = (portPairUse[pairKey] || 0) + 1;
      if (portPairUse[pairKey] === 2) {
        errors.push("Enlace duplicado entre " + key1 + " y " + key2);
      }

      if (owner1) linkedDevices[owner1] = true;
      if (owner2) linkedDevices[owner2] = true;

      if (owner1 && owner2 && owner1 !== owner2) {
        edges.push({
          from: owner1,
          to: owner2,
          portFrom: n1,
          portTo: n2,
          objFrom: p1,
          objTo: p2,
        });
        if (!adjacency[owner1]) adjacency[owner1] = [];
        if (!adjacency[owner2]) adjacency[owner2] = [];
        adjacency[owner1].push(owner2);
        adjacency[owner2].push(owner1);
      }
    }

    // Puertos (equipo::puerto) que participan en mas de un enlace
    for (var pu in portUse) {
      if (!Object.prototype.hasOwnProperty.call(portUse, pu)) continue;
      if (portUse[pu] > 1) {
        errors.push("Interfaz repetida: " + pu + " participa en " + portUse[pu] + " enlaces");
      }
    }

    // Dispositivos sin ningun enlace (huerfanos)
    for (var d = 0; d < devices.length; d++) {
      if (!linkedDevices[devices[d]]) orphans.push(devices[d]);
    }

    // --- Deteccion de ciclos (DFS sobre el grafo de enlaces) ---
    // El grafo es NO DIRIGIDO: A-B y B-A son el mismo enlace, asi que volver al
    // padre directo del DFS NO es un ciclo (si no, cada enlace A<->B se reportaria
    // como "A -> B -> A" y "B -> A -> B"). Un ciclo real exige un camino de vuelta
    // distinto de la arista contraria inmediata, es decir longitud >= 3 (A-B-C-A).
    var state = {};
    var dfs = function (node, parent, stack) {
      state[node] = 1;
      stack.push(node);
      var vecinos = adjacency[node] || [];
      for (var v = 0; v < vecinos.length; v++) {
        var next = vecinos[v];
        if (next === parent) continue; // arista contraria inmediata: no es ciclo
        if (state[next] === 1) {
          var idx = stack.indexOf(next);
          if (idx < 0 || stack.length - idx < 3) continue; // ciclo de longitud 2
          var cycle = stack.slice(idx);
          var text = cycle.join(" -> ") + " -> " + next;
          if (loops.indexOf(text) === -1) loops.push(text);
        } else if (!state[next]) {
          dfs(next, node, stack);
        }
      }
      stack.pop();
      state[node] = 2;
    };
    for (var g = 0; g < devices.length; g++) {
      if (!state[devices[g]]) dfs(devices[g], null, []);
    }

    // --- Hosts en subredes distintas conectados directamente ---
    for (var e = 0; e < edges.length; e++) {
      var edge = edges[e];
      var tFrom = deviceTypeByName[edge.from];
      var tTo = deviceTypeByName[edge.to];
      if (!__isHostType(tFrom) || !__isHostType(tTo)) continue;

      var ip1 = __portIp(edge.objFrom);
      var ip2 = __portIp(edge.objTo);
      if (ip1 === null || ip2 === null) continue; // sin API de IP no concluimos
      var mask1 = __portMask(edge.objFrom);
      var mask2 = __portMask(edge.objTo);
      if (mask1 === null || mask2 === null) continue;

      var same = __sameSubnet(ip1, mask1, ip2, mask2);
      if (same === false) {
        errors.push(
          "Hosts en subredes distintas conectados directamente: " +
            edge.from +
            " (" +
            ip1 +
            ") <-> " +
            edge.to +
            " (" +
            ip2 +
            ")"
        );
      }
    }

    // --- Hosts con enlaces pero sin IP (solo aviso) ---
    for (var h = 0; h < devices.length; h++) {
      var dnm = devices[h];
      if (!__isHostType(deviceTypeByName[dnm])) continue;
      if (!linkedDevices[dnm]) continue;

      var hasIp = false;
      var portsH = devicePorts[dnm] || [];
      for (var pi = 0; pi < portsH.length; pi++) {
        var ipVal = __portIp(portsH[pi]);
        if (ipVal === null) continue;
        var norm = String(ipVal).replace(/^\s+|\s+$/g, "");
        if (norm && norm !== "0.0.0.0" && norm !== "undefined") hasIp = true;
      }
      if (!hasIp) warnings.push("Host sin IP con enlaces: " + dnm);
    }

    return {
      success: true,
      errors: errors,
      warnings: warnings,
      orphans: orphans,
      loops: loops,
      unresolvedLinks: unresolvedLinks,
      nullPortLinks: nullPortLinks,
    };
  } catch (error) {
    return fail("Error validating topology", error);
  }
};

// ---------------------------------------------------------------------------
// PING: VIA PDU (primero) Y VIA CLI (respaldo)
//
// El ping por PDU es la via OFICIAL de Packet Tracer: mide la alcanzabilidad
// real con el trafico que de verdad recorre la topologia y NO toca la consola
// del equipo, que es de donde vienen todos los fallos de la via CLI (dialogo
// inicial, pantalla de arranque, lookup DNS, corte de buffer, comando
// mutilado).
//
// RIESGO HISTORICO (motivo de la pre-validacion): llamar a `addSimplePdu`
// contra un equipo SIN IP utilizable abre en PT un dialogo modal "No Functional
// Ports" que CONGELA Packet Tracer. Por eso `pduPing` comprueba las IP de los
// dos equipos ANTES y, si falta alguna, devuelve `no_ip` SIN LLAMAR NUNCA a
// `addSimplePdu`.
// ---------------------------------------------------------------------------

// Payload de pingDevices: contrato exacto con los valores por defecto de un
// ping no ejecutado (sin envios, sin perdida, `ok` a false y `reversed` false).
// `metodo` y `sourceIp` son ADITIVOS: el backend los ignora y solo los leen el
// agente y la suite para saber por que via se resolvio el ping.
function __payloadPing(sourceName, targetName) {
  return {
    success: true,
    ok: false,
    source: sourceName,
    target: targetName,
    reversed: false,
    protocol: "ICMP",
    sourceIp: "",
    targetIp: "",
    sent: 0,
    received: 0,
    lossPercent: 0,
    rttAvg: 0,
    status: "",
    output: "",
    metodo: "",
  };
}

// IP util de un puerto: "" si la API no existe o si no hay direccion usable.
function __ipDePuerto(port) {
  var ip = __portIp(port);
  if (ip === null || ip === undefined) return "";
  var texto = String(ip).replace(/^\s+|\s+$/g, "");
  if (!texto || texto === "0.0.0.0" || texto === "undefined" || texto === "null") return "";
  return texto;
}

// IP del equipo `destino` para hacerle ping desde `origen`: primero la interfaz
// conectada al origen (enlaces Link.getPort1/getPort2 + Port.getOwnerDevice) y,
// si esa no tiene IP, cualquier otra IP del destino. "" si no hay ninguna.
function __ipParaPing(origen, destino) {
  var net = ipc.network();
  try {
    var total = net.getLinkCount();
    for (var i = 0; i < total; i++) {
      var link = net.getLinkAt(i);
      if (!link) continue;
      var p1 = null;
      var p2 = null;
      try {
        p1 = link.getPort1();
        p2 = link.getPort2();
      } catch (eEnlace) {
        continue;
      }
      if (!p1 || !p2) continue;
      var dueno1 = __portDeviceName(p1);
      var dueno2 = __portDeviceName(p2);
      var ip = "";
      if (dueno1 === origen && dueno2 === destino) ip = __ipDePuerto(p2);
      else if (dueno2 === origen && dueno1 === destino) ip = __ipDePuerto(p1);
      if (ip) return ip;
    }
  } catch (eRed) {
    // sin API de enlaces: seguimos con las interfaces del propio equipo
  }

  var equipo = null;
  try {
    equipo = net.getDevice(destino);
    for (var q = 0; equipo && q < equipo.getPortCount(); q++) {
      var ipPuerto = __ipDePuerto(equipo.getPortAt(q));
      if (ipPuerto) return ipPuerto;
    }
  } catch (ePuertos) {
    // sin API de puertos no hay mas fuentes de IP que probar
  }
  return "";
}

// Lee de la salida del `ping` de IOS la tasa de exito, los paquetes
// (recibidos/enviados), la perdida y el RTT medio. null si no hay ping valido.
function __parsearPing(salida) {
  var texto = String(salida || "");
  var tasa = texto.match(/Success\s+rate\s+is\s+(\d+)\s+percent(?:\s*\((\d+)\s*\/\s*(\d+)\))?/i);
  if (!tasa) return null;
  var porcentaje = parseInt(tasa[1], 10);
  if (isNaN(porcentaje)) return null;

  // IOS envia 5 paquetes por defecto; si la salida trae (recibidos/enviados),
  // ese parentesis manda sobre el valor por defecto.
  var enviados = 5;
  var recibidos = Math.round((porcentaje * enviados) / 100);
  if (tasa[2] !== undefined && tasa[3] !== undefined) {
    var r = parseInt(tasa[2], 10);
    var s = parseInt(tasa[3], 10);
    if (!isNaN(r) && !isNaN(s) && s > 0) {
      enviados = s;
      recibidos = r;
    }
  }

  var rtt = 0;
  var rttLinea = texto.match(/Round-trip\s+min\/avg\/max\s*=\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/i);
  if (rttLinea) {
    var media = parseInt(rttLinea[2], 10);
    if (!isNaN(media)) rtt = media;
  }

  return {
    ok: porcentaje > 0,
    enviados: enviados,
    recibidos: recibidos,
    perdida: Math.max(0, Math.min(100, 100 - porcentaje)),
    rtt: rtt,
  };
}

// ---------------------------------------------------------------------------
// PING POR PDU (via principal)
//
// MEDIDO contra Packet Tracer 9 real
// (`packages/server/scripts/pt-diag-pduping.ts`; el sondeo anterior
// `pt-diag-pdu.ts` dio una conclusion FALSA porque PT ya estaba en simulacion):
//   * EL PDU SOLO FLUJA EN MODO SIMULACION. En tiempo real, `addSimplePdu` +
//     `forward()` NO crean ni un frame (medido: 0 frames nuevos). Por eso el
//     ping ENTRA en simulacion antes de crear el PDU y SALE al terminar,
//     devolviendo PT al modo que tenia.
//   * `appWindow().getUserCreatedPDU().addSimplePdu(origen, destino)` devuelve
//     un `errCode` (0/falsy = OK); cualquier otro valor es un ADD_PDU_ERROR.
//     Solo acepta NOMBRES de dispositivo (no IPs).
//   * Los frames SOLO avanzan si se llama a `sim.forward()`: sin `forward()` se
//     quedan en `buffered`. Un ping necesita varios pasos (medidos 16 y 34
//     frames nuevos en un solo PDU; con `resetSimulation()` el viaje son ~5-8
//     frames utiles dentro de un total que puede llegar a 50), asi que el
//     presupuesto es de 40 pasos de 100 ms (4 s como peor caso).
//   * MEDIDO (PT 9, volcado de 50 frames de un PDU `PC1 -> R1`): los frames van
//     de `buffered` a `sent` y vuelven a `buffered`; `accepted` NO aparecio en
//     ese volcado. Por eso la señal principal del veredicto NO puede depender
//     de `accepted`. Las claves de un frame son `destination`, `device`,
//     `index`, `source`, `status`, `trafficType` y `transitTime`.
//   * `transitTime` vale 0 o 1: son UNIDADES DE SIMULACION, no milisegundos
//     (por eso el RTT se mide con el reloj de simulacion, ver abajo).
//   * `getSourceString()` / `getDestinationString()` devuelven CADENA VACIA, asi
//     que los frames se identifican por INDICE y, para atribuirlos, por
//     `getDevice()` (que SI funciona: 50 de 50 frames con nombre de equipo).
//   * Los PDUs de pings anteriores siguen PENDIENTES y avanzan con nuestros
//     `forward()`: la medicion arranca con `sim.resetSimulation()` (que NO toca
//     la topologia ni la configuracion de los equipos, solo frames y reloj).
//
// VEREDICTO (como se distingue "llego" de "no llego"):
//   * SENAL PRINCIPAL: el VIAJE DE IDA Y VUELTA. MEDIDO en PT 9, un ping que
//     funciona deja esta firma en los frames de la pareja, ordenados por indice:
//     `16 PC1` (sale) -> `17 SW1` -> `18 SW1` -> `19 R1` (llega) -> `20 PC1` (vuelve
//     la respuesta). O sea, la regla que implementa `__analisisFrames`: un frame
//     VIVO en el DESTINO y, POSTERIOR a el (INDICE MAYOR), otro frame VIVO en el
//     ORIGEN. El intermediario (switch) se IGNORA: destino -> origen basta.
//     `viajeCompleto` es lo que se expone, y es la unica señal que da `ok` por
//     si sola.
//   * `accepted` (que en PT 9 puede NO aparecer nunca) es una señal ADICIONAL: si
//     aparece, `accepted` en el DESTINO = llego y en el ORIGEN = volvio la
//     respuesta. Cualquiera de las dos tambien da `ok:true`.
//   * Viaje completo o `accepted` -> `ok:true`, `received:1`, `lossPercent:0`.
//   * Solo `dropped` / `not_forwarded` / `unexpected` / colisiones -> `no_reply`
//     con `lossPercent:100` (el mismo valor que ya usa el ping CLI cuando no hay
//     respuesta, asi que el backend no necesita cambios) y el `output` dice si
//     el descarte fue en origen o en destino.
//   * Se agotan los pasos sin firma de viaje -> `no_reply` INCONCLUSO (nunca
//     `ok`): preferimos un "no pude afirmar" a un falso "llego".
//
// El RTT sale del RELOJ DE SIMULACION (`getCurrentSimTime()` medido antes y
// despues del PDU), NO de `getTransitTime()`: MEDIDO en PT 9, `transitTime` vale
// 0 o 1 y son unidades de simulacion, asi que ponerlo en `rttAvg` se leeria como
// milisegundos y seria mentira. El `output` lo dice y `rttUnidad` deja el dato
// explicito. El `transitTime` de los frames del viaje viaja aparte en
// `transitViaje` (suma de los dos frames de la firma). Si no hay nada fiable:
// `rttAvg:0` y `rttFuente:"sin_dato"`.
//
// LIMPIEZA DEL ESCENARIO: `addSimplePdu` devuelve SOLO el errCode y
// `UserCreatedPDU` no expone un indice de escenario en la API documentada, asi
// que NO se adivina un indice a lo bruto (borrar el escenario equivocado seria
// peor que dejar la entrada). Se intenta un indice de confianza: si el objeto
// expone un contador de PDUs, el escenario nuevo es el ULTIMO y se borra en el
// `finally`; si no, el payload lleva `pduPendiente:true` y cada ping deja una
// entrada en la lista de PDUs de PT, que se limpia desde la UI.
// ---------------------------------------------------------------------------

// Tipos de equipo SIN PDU de usuario en PT 9. Es una lista de EXCLUSION, no de
// inclusion: un tipo desconocido se intenta y decide `addSimplePdu` (que es el
// arbitro final). Incluye IoT y potencias (39), paneles de parcheo (46/47),
// WLC (41), AccessPoint (7), pasivos (5/6/29/31/32), camaras y sniffers (34/35),
// MCU/SBC (36/37), Controllers (50) y los metali (48/49).
var TIPOS_SIN_PDU = {
  5: 1, 6: 1, 7: 1, 11: 1, 13: 1, 14: 1, 21: 1, 22: 1, 29: 1, 31: 1, 32: 1,
  34: 1, 35: 1, 36: 1, 37: 1, 39: 1, 41: 1, 44: 1, 45: 1, 46: 1, 47: 1,
  48: 1, 49: 1, 50: 1,
};

// true si el equipo puede originar un PDU simple. Con la API de tipo
// ilegible se responde true: que decida `addSimplePdu`.
function __admitePdu(device) {
  var tipo = -1;
  try {
    tipo = Number(device.getType());
  } catch (eT) {
    tipo = -1;
  }
  if (isNaN(tipo) || tipo < 0) return { ok: true, tipo: -1 };
  if (TIPOS_SIN_PDU[tipo] === 1) return { ok: false, tipo: tipo };
  return { ok: true, tipo: tipo };
}

// Primera IP utilizable de un equipo, sea cual sea su interfaz (primero la que
// el `vecino` tiene conectada y, si esa no tiene, cualquier otra). "" si no hay
// ninguna: ese "" es la senal que obliga a NO llamar a `addSimplePdu`.
function __ipUtilDe(vecino, nombreEquipo) {
  if (!nombreEquipo) return "";
  if (vecino) {
    var ip = __ipParaPing(vecino, nombreEquipo);
    if (ip && __ipToLong(ip) !== null) return ip;
  }
  var equipo = null;
  try {
    equipo = ipc.network().getDevice(nombreEquipo);
    for (var q = 0; equipo && q < equipo.getPortCount(); q++) {
      var ipPuerto = __ipDePuerto(equipo.getPortAt(q));
      if (ipPuerto && __ipToLong(ipPuerto) !== null) return ipPuerto;
    }
  } catch (ePuertos) {
    // sin API de puertos: se prueba la del propio equipo
  }
  try {
    var directa = __dirUtil(__valorDir(equipo, DIR_IP));
    if (directa) return directa;
  } catch (eDir) {
    // sin direccion a nivel de equipo
  }
  return "";
}

// ---------------------------------------------------------------------------
// ESTADO DE LAS INTERFACES (pre-flight del ping por PDU)
//
// MEDIDO contra Packet Tracer 9: un PDU recien creado se puede quedar EN COLA en
// el origen sin llegar a transmitirse nunca. El sintoma era un veredicto que
// decia "el equipo destino no responde" cuando el problema era del ENLACE del
// propio ORIGEN: los enlaces tardan unos segundos en levantar despues de
// configurar el equipo (`no shutdown` + `configurePcIp`) y `reachabilityMatrix`,
// que hace los mismos pings DESPUES, si pasa. Era una condicion de carrera.
//
// La API documentada de `Port`
// (`help/default/IpcAPI/class_port-members.html`) declara justo lo que hace falta
// y no se usaba en ningun sitio del fichero: `getName()`, `getLink()`,
// `isPortUp()` e `isProtocolUp()`.
//
// POR QUE `ok` ES "CABLE + isPortUp()" Y NO "isProtocolUp()": `isProtocolUp()`
// en un router depende de que el line protocol este arriba, que ya es cosa de la
// CONFIGURACION (direccion, mascara, encapsulation), asi que exigirlo bloquearia
// pings validos de un equipo recien configurado. `isPortUp()` es el estado del
// ENLACE, que es exactamente lo que hay que esperar tras cablear.
//
// `desconocido` = la API no se puede leer en ese equipo (no hay
// `getPortCount`/`getPortAt`, `isPortUp` no existe o devuelve algo que no es
// booleano, no hay puertos legibles...). NO es "no esta listo": es "no se puede
// comprobar", y el llamante sigue adelante SIN esperar: esperar a algo que no se
// puede medir solo alarga el ping.
// ---------------------------------------------------------------------------

// Normaliza a true/false la respuesta de un metodo de `Port`. null si la API no
// existe, lanza o devuelve algo que no es booleano (o sea: no se puede afirmar).
function __boolDePuerto(port, metodo) {
  if (!port) return null;
  try {
    if (typeof port[metodo] !== "function") return null;
    var v = port[metodo]();
    if (v === true || v === 1) return true;
    if (v === false || v === 0) return false;
    return null;
  } catch (e) {
    return null;
  }
}

// Enlace de un puerto: true si tiene cable, false si se pudo leer y no lo tiene,
// null si `getLink()` no existe o lanza en ESE puerto (no se puede afirmar).
function __puertoConCable(port) {
  if (!port) return null;
  try {
    if (typeof port.getLink !== "function") return null;
    return !!port.getLink();
  } catch (e) {
    return null;
  }
}

// Estado accionable de las interfaces de un equipo, con la API real de `Port`
// (`getPortCount`/`getPortAt` + `getName`/`getLink`/`isPortUp`/`isProtocolUp`).
// Cada puerto va en su propio try/catch: uno que lance NO invalida los demas.
// `ok` = hay al menos un puerto CON CABLE y con `isPortUp()` a true.
function __estadoInterfaz(device) {
  var res = {
    ok: false,
    desconocido: false,
    cableDesconocido: false,
    tieneCable: false,
    puertoArriba: false,
    protocoloArriba: false,
    puertoNombre: "",
    puertoProblema: "",
    totalPuertos: 0,
    puertosLeidos: 0,
    puertosConCable: 0,
    puertosArriba: 0,
    puertosSinCable: 0,
    puertosEnlaceIlegible: 0,
  };
  var i = 0;
  var puertos = [];
  if (!device) {
    res.desconocido = true;
    return res;
  }
  try {
    if (typeof device.getPortCount !== "function" || typeof device.getPortAt !== "function") {
      res.desconocido = true;
      return res;
    }
    var total = Number(device.getPortCount());
    if (isNaN(total) || total < 0) {
      res.desconocido = true;
      return res;
    }
    res.totalPuertos = Math.floor(total);
    for (i = 0; i < res.totalPuertos; i++) {
      var p = null;
      try {
        p = device.getPortAt(i);
      } catch (ePuerto) {
        p = null;
      }
      if (p) puertos.push(p);
    }
  } catch (eEnum) {
    res.desconocido = true;
    return res;
  }
  res.puertosLeidos = puertos.length;
  if (puertos.length === 0) {
    res.desconocido = true;
    return res;
  }

  var leidoEstado = false;
  var conEnlace = 0;
  var sinEnlace = 0;
  var enlaceIlegible = 0;
  for (i = 0; i < puertos.length; i++) {
    var port = puertos[i];
    // Nombre por la API declarada (`getName`) y, si no existe, por los legacy
    // (`getPortName`, `getDisplayName`): "" si ninguno responde. El propio
    // helper va en try/catch por nombre, asi que un puerto que revienta al
    // nombrarse NO invalida el resto.
    var nombre = __puertoNombreDe(port);
    var cable = __puertoConCable(port);
    if (cable === null) enlaceIlegible++;
    else if (cable) conEnlace++;
    else sinEnlace++;

    var arriba = __boolDePuerto(port, "isPortUp");
    if (arriba !== null) leidoEstado = true;

    // Un puerto cuenta si TIENE CABLE o si no se pudo leer si lo tiene: en los
    // dos casos `isPortUp()` es el estado del ENLACE y lo que decide. `cable:false`
    // (se sabe que NO tiene cable) no cuenta: ese puerto no puede transmitir.
    if (cable === false) continue;
    if (cable === true) res.puertosConCable++;
    if (!res.puertoNombre) res.puertoNombre = nombre;
    if (arriba === true) {
      res.puertosArriba++;
      res.puertoArriba = true;
      if (__boolDePuerto(port, "isProtocolUp") === true) res.protocoloArriba = true;
    } else if (arriba === false && !res.puertoProblema) {
      // Primer puerto que puede tener cable y NO esta operativo: es el que se
      // nombra en el `output` de `interfaz_no_lista`.
      res.puertoProblema = nombre;
    }
  }

  // Si NO se pudo leer el enlace de NINGUN puerto, no se puede afirmar que no
  // tenga cable: se cuenta como "con cable" para que un equipo sin cables NO
  // bloquee el ping para siempre.
  res.cableDesconocido = enlaceIlegible >= puertos.length;
  res.puertosSinCable = sinEnlace;
  res.puertosEnlaceIlegible = enlaceIlegible;
  res.tieneCable = res.cableDesconocido ? res.puertosLeidos > 0 : conEnlace > 0;
  res.ok = res.tieneCable && res.puertoArriba;
  // `isPortUp` ilegible en TODOS los puertos: no se puede comprobar si el
  // enlace esta operativo, y eso NO es "no esta listo".
  res.desconocido = !leidoEstado;
  // `puertoProblema` solo se consulta cuando el equipo NO esta listo: si hay un
  // puerto operativo, no hay ningun puerto culpable que nombrar.
  if (res.ok || res.desconocido) res.puertoProblema = "";
  return res;
}

// Presupuesto de espera del pre-flight de interfaces. MEDIDO: tras configurar un
// equipo los enlaces tardan "unos segundos" en levantar; con 13 intentos cada
// 400 ms el pre-flight espera hasta 4800 ms (< 5 s) y su coste cabe en el
// presupuesto de `pduPing` (5 s + 4 s de pasos = 9 s) y en los 60 s de timeout de
// `pingDevices` (peor caso: 5 s + 4 s + sonda inversa 5 s + 4 s = 18 s).
var INTERFAZ_ESPERA_MAX_MS = 5000;
var INTERFAZ_PASO_MS = 400;

// Espera a que origen y destino tengan interfaz operativa, comprobando cada
// `pasoMs`. El numero de intentos se deriva del PRESUPUESTO (no del reloj): el
// motor de scripts de PT no expone timers sincronos y la espera es
// `__busyWait`, asi que el techo se lleva con cuentas y no con `Date.now()`.
//
// Devuelve `lista:true` en cuanto ambos estan listos; `desconocida:true` si en
// algun equipo la API no se puede leer (eso NO bloquea: no se puede comprobar,
// no es "no esta listo"), y `lista:false` si se agota el presupuesto.
function __esperarInterfazLista(origen, destino, esperaMaxMs, pasoMs) {
  var res = {
    lista: false,
    desconocida: false,
    intentos: 0,
    esperas: 0,
    esperaMs: 0,
    origen: null,
    destino: null,
  };
  var paso = typeof pasoMs === "number" && pasoMs > 0 ? Math.floor(pasoMs) : INTERFAZ_PASO_MS;
  var tope = typeof esperaMaxMs === "number" && esperaMaxMs > 0 ? Math.floor(esperaMaxMs) : 0;
  var maxIntentos = Math.floor(tope / paso) + 1;
  if (maxIntentos < 1) maxIntentos = 1;
  var i = 0;
  for (i = 0; i < maxIntentos; i++) {
    res.intentos = i + 1;
    res.origen = __estadoInterfaz(origen);
    res.destino = __estadoInterfaz(destino);
    // No se puede comprobar en algun equipo: seguir sin esperar.
    if (res.origen.desconocido || res.destino.desconocido) {
      res.desconocida = true;
      break;
    }
    if (res.origen.ok && res.destino.ok) {
      res.lista = true;
      break;
    }
    if (i < maxIntentos - 1) {
      __busyWait(paso);
      res.esperas++;
    }
  }
  res.esperaMs = res.esperas * paso;
  return res;
}

// Nombres de puerto tolerantes: el que declara la API (`getName`) y los metodos
// legacy de PT (`getPortName`, `getDisplayName`), que es lo que ya se usa en el
// resto del fichero. "" si ninguno responde.
function __puertoNombreDe(port) {
  var nombres = ["getName", "getPortName", "getDisplayName"];
  for (var i = 0; i < nombres.length; i++) {
    try {
      if (typeof port[nombres[i]] !== "function") continue;
      var v = port[nombres[i]]();
      if (v !== undefined && v !== null && String(v) !== "") return String(v);
    } catch (e) {
      // probamos el siguiente nombre de metodo
    }
  }
  return "";
}

// Una frase por equipo que explica por que su interfaz no estaba operativa:
// "no tiene cable" o "el puerto X no tiene enlace operativo". "" si el estado
// no lo explica (no se pudo comprobar).
function __fraseSinInterfaz(nombreEquipo, estado) {
  if (!estado || estado.desconocido || estado.ok) return "";
  var etiqueta = "'" + String(nombreEquipo) + "'";
  if (!estado.tieneCable) {
    return etiqueta + " no tiene ningun puerto con cable conectado (" + estado.puertosLeidos + " puerto(s) legibles)";
  }
  var donde = estado.puertoProblema || estado.puertoNombre || "sin nombre";
  return (
    etiqueta + " tiene la interfaz " + donde + " sin enlace operativo (isPortUp: false" +
    (estado.protocoloArriba ? "" : ", isProtocolUp: false") + ")"
  );
}

// Texto de `interfaz_no_lista`. Dice que equipo y que puerto estaban caidos y,
// sobre todo, que el problema NO es del destino ni de la topologia: sin eso el
// agente cambia una configuracion correcta por un falso diagnostico. `esperaMs`
// es la espera REALMENTE hecha (`pre.esperaMs`), no el presupuesto.
function __mensajeInterfazNoLista(origen, destino, pre, esperaMs) {
  var malos = [];
  var o = __fraseSinInterfaz(origen, pre.origen);
  var d = __fraseSinInterfaz(destino, pre.destino);
  if (o) malos.push(o);
  if (d) malos.push(d);
  var detalle = malos.length > 1 ? malos.join(" y ") : malos[0] || "las interfaces no estaban operativas";
  return (
    "PDU ICMP " + origen + " -> " + destino + ": NO se creo el PDU porque " + detalle +
    " tras esperar " + esperaMs + " ms (comprobado cada " + INTERFAZ_PASO_MS + " ms, " +
    pre.intentos + " intento(s)). El problema es del ENLACE de esa interfaz (recien configurada y sin " +
    "terminar de levantar), NO del destino ni de la topologia: no cambies la configuracion de " +
    destino + " ni las rutas, espera unos segundos y repite el ping."
  );
}

// Estados en los que el frame ha MUERTO por el camino. Ninguno cuenta como
// "llego" ni como "volvio": un frame que se cayo no prueba nada.
function __frameMuerto(f) {
  var st = f && f.status ? String(f.status) : "";
  return (
    st === "dropped" || st === "not_forwarded" || st === "unexpected" || st === "collision"
  );
}

// Copia de los frames ORDENADA por `index` (el indice del escenario es el unico
// orden fiable: hay que comparar "posterior" por indice, nunca por la posicion
// del array, porque PT no garantiza el orden y un ping puede releer la lista).
function __framesOrdenados(frames) {
  var lista = [];
  var i = 0;
  for (i = 0; i < frames.length; i++) lista.push(frames[i] || {});
  lista.sort(function (a, b) {
    var ia = typeof a.index === "number" && isFinite(a.index) && a.index >= 0 ? a.index : 0;
    var ib = typeof b.index === "number" && isFinite(b.index) && b.index >= 0 ? b.index : 0;
    return ia - ib;
  });
  return lista;
}

// Indice de escenario de un frame del payload (o su posicion si no lo trae).
function __indiceDe(f, pos) {
  if (f && typeof f.index === "number" && isFinite(f.index) && f.index >= 0) return f.index;
  return pos;
}

// `transitTime` del frame con ese indice de escenario, o -1 si no lo trae o no
// es utilizable. MEDIDO: vale 0 o 1 y son unidades de simulacion, no ms.
function __transitDe(indice, frames) {
  if (indice < 0) return -1;
  for (var i = 0; i < frames.length; i++) {
    var f = frames[i] || {};
    if (__indiceDe(f, i) !== indice) continue;
    var tt = f.transitTime;
    if (typeof tt === "number" && isFinite(tt) && tt >= 0) return tt;
    return -1;
  }
  return -1;
}

// Analiza los frames YA FILTRADOS por la pareja (ver `__framesDePareja`) y
// reparte el veredicto.
//
// SENAL PRINCIPAL = VIAJE DE IDA Y VUELTA (MEDIDO en PT 9, no es suposicion):
// con los frames ordenados por indice, el ping funciona si existe un frame VIVO
// en el DESTINO y, POSTERIOR a el (INDICE MAYOR), otro frame VIVO en el ORIGEN.
// Ese ultimo frame es la respuesta que vuelve; el intermediario (switch) se
// IGNORA, porque destino -> origen ya es inequivoco. MEDIDO, la firma es
//   16 PC1 (sale) -> 17 SW1 -> 18 SW1 -> 19 R1 (llega) -> 20 PC1 (vuelve)
// y ahi NO hay ningun `accepted`.
//
// OJO con un detalle que el volcado REAL obliga a respetar: NO vale "el primer
// frame del destino" + "el primer frame del origen". En el volcado medido hay un
// `PC1` en el indice 0 y un `R1` en el 1 (el PDU tambien deja frames antes de
// llegar al switch), asi que la pareja por posicion daria el 0 y el 1 y NUNCA
// habria viaje. La regla es de EXISTENCIA: cualquier frame del destino seguido
// (por indice) de cualquier frame del origen. Para nombrar la pareja en el
// payload se elige la de menor separacion (en el volcado medido sale 19 -> 20,
// que es exactamente la firma), que es la que mejor explica el intercambio.
//
// `accepted` es una señal ADICIONAL (puede no aparecer nunca): `aceptadoDestino`
// = el PDU llego (en PT lo acepta el EQUIPO que lo recibe: un switch reenvia, no
// acepta) y `aceptadoOrigen` = la respuesta volvio. `aceptadoSinEquipo` = hay
// entrega pero PT no dice en que equipo (solo cuando `getDevice()` no es
// utilizable: entonces el rango de indices es lo unico que hay, y un `accepted`
// sigue siendo entrega porque lo acepta el equipo que lo recibe).
//
// CONSERVADORISMO: un frame `buffered` esta EN COLA, asi que no prueba ni
// llegada ni retorno (`destinoEnCola` / `origenEnCola` lo dejan dicho para el
// `output`). Si solo hay eso, el ping queda INCONCLUSO: es preferible no poder
// afirmar que afirmar un "llego" falso.
//
// Los negativos se guardan con su equipo para poder decir en el `output` si el
// PDU se cayo en origen, en destino o en un equipo intermedio.
//
// `noSalioDelOrigen` separa los DOS fallos que antes se contaban como el mismo
// ("el equipo destino no responde"): el PDU que se queda ENCOLADO en el origen
// (interfaz del origen sin enlace: `buffered`, o `not_forwarded`/`dropped` alli)
// NO dice NADA del destino, y decirlo induce a cambiar una configuracion que ya
// era correcta. MEDIDO en PT 9: ese era el fallo de `pingTopology` tras montar la
// topologia (2 frames de ICMP, el PDU sin salir de PC1, y el sentido contrario
// respondiendo porque para entonces el enlace ya habia levantado).
//
// REGLA (conservadora: cualquier evidencia en contra lo desactiva):
//   `ordenados > 0` (hay frames del PDU) Y
//   NINGUN frame VIVO llego al destino Y
//   no hay frames del PDU EN COLA en el destino (si hay uno, algo se movio) Y
//   no hay frames VIVOS sin atribuir (`getDevice()` no utilizable) Y
//   el unico negativo, si lo hay, es en el ORIGEN (si se cayo en el destino, el
//   problema es de alli y se sigue diciendo "descartado en <destino>").
function __analisisFrames(frames, origen, destino) {
  var res = {
    aceptadoDestino: null,
    aceptadoOrigen: null,
    aceptadoSinEquipo: null,
    negativo: null,
    negativoEn: "",
    ordenados: 0,
    llegoAlDestino: false,
    volvioAlOrigen: false,
    viajeCompleto: false,
    destinoEnCola: false,
    origenEnCola: false,
    noSalioDelOrigen: false,
    vivosAjenos: 0,
    indiceDestino: -1,
    indiceOrigen: -1,
    indiceDestinoCola: -1,
    indiceOrigenCola: -1,
  };
  var lista = __framesOrdenados(frames);
  res.ordenados = lista.length;
  // Frames VIVOS por equipo (ordenados por indice, porque `lista` ya lo esta):
  // un frame vivo es el que ya salio de la cola y no se cayo por el camino.
  var vivosDestino = [];
  var vivosOrigen = [];
  var i = 0;
  for (i = 0; i < lista.length; i++) {
    var f = lista[i];
    var nombre = f.device ? String(f.device) : "";
    var idx = __indiceDe(f, i);
    var muerto = __frameMuerto(f);
    var enCola = f.status === "buffered";

    // 1) Entregas por `accepted` (señal adicional, independiente del viaje).
    if (f.status === "accepted") {
      if (nombre === String(destino)) {
        if (!res.aceptadoDestino) res.aceptadoDestino = f;
      } else if (nombre === String(origen)) {
        if (!res.aceptadoOrigen) res.aceptadoOrigen = f;
      } else if (!res.aceptadoSinEquipo) {
        res.aceptadoSinEquipo = f;
      }
    }

    // 2) Viaje de ida y vuelta: se separa por equipo y se empareja despues (paso
    //    4), porque un frame del ORIGEN anterior a la llegada es la SALIDA del
    //    PDU, no la respuesta.
    if (nombre === String(destino)) {
      if (!muerto && !enCola) {
        vivosDestino.push(idx);
      } else if (!muerto) {
        res.destinoEnCola = true;
        if (res.indiceDestinoCola < 0) res.indiceDestinoCola = idx;
      }
    } else if (nombre === String(origen)) {
      if (!muerto && !enCola) {
        vivosOrigen.push(idx);
      } else if (!muerto) {
        res.origenEnCola = true;
        if (res.indiceOrigenCola < 0) res.indiceOrigenCola = idx;
      }
    } else if (!muerto && !enCola) {
      // Vivo pero NI de la pareja: sin `getDevice()` utilizable no se puede
      // atribuir. Cuenta como evidencia en contra de "no salio del origen".
      res.vivosAjenos++;
    }

    // 3) Primer veredicto negativo (con su equipo).
    if (!res.negativo && muerto) {
      res.negativo = f;
      res.negativoEn = nombre;
    }
  }

  // 4) El VIAJE COMPLETO: un frame vivo del destino y OTRO vivo del origen con
  //    indice MAYOR. Es de EXISTENCIA (cualquiera de los dos vale), no "el
  //    primero de cada": el volcado medido tiene `PC1` en el 0 y `R1` en el 1,
  //    y con "el primero de cada" no habria viaje NUNCA. Si hay pareja, se
  //    nombra la de MENOR separacion (en el volcado medido sale 19 -> 20, que es
  //    la firma: la llegada y la respuesta inmediatamente posterior).
  var mejorGap = -1;
  for (i = 0; i < vivosOrigen.length; i++) {
    for (var j = 0; j < vivosDestino.length; j++) {
      var hueco = vivosOrigen[i] - vivosDestino[j];
      // El retorno tiene que ser POSTERIOR a la llegada: si no, es la salida.
      if (hueco <= 0) continue;
      if (mejorGap < 0 || hueco < mejorGap) {
        mejorGap = hueco;
        res.indiceDestino = vivosDestino[j];
        res.indiceOrigen = vivosOrigen[i];
      }
    }
  }
  res.llegoAlDestino = vivosDestino.length > 0;
  // Sin llegada al destino NO hay viaje, aunque el origen tenga frames (eso seria
  // la respuesta de otro PDU o un rebote).
  res.volvioAlOrigen = res.llegoAlDestino && mejorGap > 0;
  res.viajeCompleto = res.volvioAlOrigen;
  // Sin pareja se informa igualmente de la PRIMERA llegada, que es lo que dice
  // el `output` del ping inconcluso ("llego pero no volvio").
  if (!res.viajeCompleto && res.llegoAlDestino) res.indiceDestino = vivosDestino[0];
  // 5) `noSalioDelOrigen` (ver la regla en la cabecera de la funcion). Nunca
  //    `true` si el ping fue `ok`: ahi el PDU SI salio.
  if (!res.viajeCompleto && !res.aceptadoDestino && !res.aceptadoOrigen && !res.aceptadoSinEquipo) {
    res.noSalioDelOrigen =
      res.ordenados > 0 &&
      !res.llegoAlDestino &&
      !res.destinoEnCola &&
      res.vivosAjenos === 0 &&
      (!res.negativo || res.negativoEn === String(origen));
  }
  return res;
}

// Contador de escenarios de PDU de usuario, o -1 si PT no lo expone. Con el
// valor ANTES de crear el PDU, el escenario nuevo es el ULTIMO: ese indice es
// el unico que se puede borrar sin adivinar.
function __contarPduUsuario(pdu) {
  if (!pdu) return -1;
  var nombres = ["getPDUCount", "getPduCount", "getUserPDUCount", "getScenarioCount"];
  for (var i = 0; i < nombres.length; i++) {
    try {
      if (typeof pdu[nombres[i]] !== "function") continue;
      var v = Number(pdu[nombres[i]]());
      if (!isNaN(v) && v >= 0) return v;
    } catch (e) {
      // probamos el siguiente nombre
    }
  }
  return -1;
}

// Borra UN escenario de PDU por indice. false si la API no existe o falla:
// preferimos dejar la entrada en la lista (se limpia desde la UI) antes que
// borrar el escenario equivocado.
function __borrarPduUsuario(pdu, indice) {
  if (!pdu || indice < 0) return false;
  var nombres = ["deletePDU", "deleteUserCreatedPDU", "deletePDUAt", "removePDU"];
  for (var i = 0; i < nombres.length; i++) {
    try {
      if (typeof pdu[nombres[i]] !== "function") continue;
      pdu[nombres[i]](indice);
      return true;
    } catch (e) {
      // probamos el siguiente nombre
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// REINTENTO DEL PDU CUANDO NO SALIO DEL ORIGEN
//
// POR QUE (medido, no es teoria): con `test-pt` sobre una topologia recien
// montada, `pingTopology` fallaba con 2 frames de ICMP y el PDU ENCOLADO en PC1,
// sin haber salido nunca. Es una condicion de carrera del primer ping:
// `reachMatrix`, que repite los MISMOS tres pings unos 10 s despues, pasa. El
// pre-flight de interfaces (`__estadoInterfaz`, que espera hasta 5 s a que
// `isPortUp()` sea true) NO lo evita: en ese caso DEVOLVIO la interfaz como
// lista y el PDU se quedo igual. Conclucion: `isPortUp()` NO es un predictor
// fiable de que el PDU vaya a salir, y la unica senal fiable es la propia
// medicion: si el PDU no salio del origen, el enlace todavia no estaba
// operativo. Por eso el reintento NO vuelve a preguntar por la interfaz (eso solo
// gastaria presupuesto y no aportaria nada: ya se vio que `isPortUp()` miente).
//
// POR QUE EL REINTENTO ES SEGURO AQUI (y por eso se distingue del reintento del
// comando por consola): el PDU NO se transmitio, luego NO produjo ningun efecto.
// No hubo paquete que saliera, ni estado remoto que cambiar, ni respuesta que
// duplicar. Reenviarlo es idempotente por construccion. En cambio, un comando de
// consola puede HABER APLICADO una escritura antes de que la lectura fallara, y
// repetirlo si podria duplicarla (de ahi que el reintento de consola tenga otros
// requisitos). Aqui la unica accion es "mandar un ICMP de medicion".
//
// CUANDO se reintenta: SOLO con `noSalioDelOrigen === true` y el ping NO `ok`
// (ver `__debeReintentarPdu`). NO se reintenta cuando el PDU si salio (llego,
// se cayo en el destino o quedo en cola): ahi hubo transmision y repetir la
// medicion solo gastaria presupuesto. NO se reintenta con ningun otro estado
// (`interfaz_no_lista`, `command_failed`, `no_ip`, ...): son fallos anteriores a
// la medicion, no una carrera del enlace.
//
// UN reintento, no mas: el segundo intento vuelve a correr el ciclo completo. Si
// tampoco sale, el veredicto es el de siempre (`no_reply` con
// `noSalioDelOrigen:true`) y el `output` dice que ya se reintento una vez: ahi la
// causa es del entorno y reintentar mas solo ralentiza la respuesta.
// ---------------------------------------------------------------------------

// Numero de reintentos del PDU (0 = solo el intento inicial, 1 = un reintento).
var PDU_REINTENTOS_MAXIMOS = 1;

// Espera antes del reintento, con el CALCULO DE PRESUPUESTO (todo en ms):
//
//   Espera antes del reintento = 800. Es lo que hace falta para que un enlace
//   recien configurado levante (medido: el pre-flight llega a esperar 4,8 s). Con
//   800 el segundo intento mide con el enlace ya despierto en el caso normal de
//   la carrera, y el ciclo completo cabe de sobra en su presupuesto.
//
//   Presupuesto PROPIO de `pduPing` (peor caso, con el reintento):
//     pre-flight 5 s + [ pasos 4 s + espera 0,8 s + pasos 4 s ] = 13,8 s
//   (sin reintento eran 9 s; el reintento anade exactamente 0,8 s + 4 s).
//
//   `pingDevices` en el backend tiene 60 s de timeout (`TIMEOUT_POR_HERRAMIENTA`):
//     PDU sentido normal 13,8 s + sonda en sentido contrario 13,8 s = 27,6 s.
//   La sonda en sentido contrario solo se lanza con `no_reply`, y no cae a la via
//   CLI en ese caso, asi que los 60 s sobran incluso con el respaldo por CLI
//   (0,7 s de espera + 2,5 s de sondeo, medidos) en el peor caso mixto.
//
//   `reachabilityMatrix` tiene 90 s y las filas se ejecutan EN SERIE, con el
//   mismo origen. Con el techo por fila que le pasa la matriz (pre-flight 1,5 s
//   = 3 esperas de 400 ms, pasos 3 s = 30 x 100 ms, espera de reintento 0,4 s):
//     10 filas x (1,2 + 3 + 0,4 + 3) = 76 s < 90 s.
//   Sin recortar esos parametros la matriz se pasaria de los 90 s (con el
//   pre-flight de 3 s que tenia antes: 10 x 10,6 = 106 s), asi que
//   `reachabilityMatrix` recorta `esperaInterfazMs` y `reintentoEsperaMs`. El
//   recorte del pre-flight no cuesta nada en el caso normal (con los enlaces ya
//   levantados el pre-flight no espera) y, cuando el enlace no levanta, las filas
//   siguientes siguen teniendo su propio margen: son 10 x 1,2 s de espera
//   acumulada en el mismo origen.
var PDU_REINTENTO_ESPERA_MS = 800;
// Tope de la espera de reintento que puede pedir quien llama (la matriz usa 400).
var PDU_REINTENTO_ESPERA_MAX_MS = 3000;

// Espera que se aplica antes del reintento, recortada por `options`.
function __esperaDelReintento(opts) {
  var porDefecto = PDU_REINTENTO_ESPERA_MS;
  if (!opts || typeof opts.reintentoEsperaMs !== "number" || opts.reintentoEsperaMs < 0) {
    return porDefecto;
  }
  return Math.min(Math.floor(opts.reintentoEsperaMs), PDU_REINTENTO_ESPERA_MAX_MS);
}

// ¿Toca a otro intento? Solo si queda presupuesto de reintentos y el veredicto
// dice que el PDU NO salio del origen (ver la cabecera de este bloque).
function __debeReintentarPdu(intento, out) {
  if (intento >= PDU_REINTENTOS_MAXIMOS) return false;
  if (!out || out.ok === true) return false;
  return out.noSalioDelOrigen === true;
}

// Frase que se anade al `output` de los dos diagnósticos "el PDU no salio del
// origen" cuando ya se ha reintentado: deja visible que el enlace del origen
// seguia sin levantarse DESPUES del reintento ("" si no hubo reintento).
function __colaDelReintento(out) {
  if (!out || out.reintentosPdu < 1) return "";
  return (
    " (ya se reintento " +
    out.reintentosPdu +
    " vez y el enlace del origen seguia sin levantar: el problema NO se resuelve reintentando, es del entorno o del cableado)"
  );
}

// Presupuesto de avance del ping por PDU: pasos de `forward()` y espera entre
// ellos.
//
// MEDIDO en PT 9 (volcado de 50 frames de un PDU `PC1 -> R1`): la firma del
// viaje de ida y vuelta esta en los indices 16 (salida en PC1), 19 (llegada en
// R1) y 20 (respuesta de vuelta en PC1), y el PDU sigue soltando frames hasta el
// 36, asi que un ping completo son 16-34 frames. 25 pasos se quedaban cortos
// (la respuesta puede volver TARDES en el volcado) y el veredicto salia
// "sin veredicto", asi que el techo es de 40 pasos.
//
// El coste total NO sube: la espera por paso baja de 150 ms a 100 ms, con lo que
// el peor caso es 40 x 100 ms = 4 s (antes 25 x 150 ms = 3,75 s) y el bucle para
// en cuanto hay veredicto por VIAJE COMPLETO (que aparece mucho antes que el
// techo). `reachabilityMatrix` acota `maxSteps:30` por fila, asi que una fila
// sigue costando 30 x 100 ms = 3 s como peor caso, el mismo que antes.
//
// POR QUE ESTAN ANTES DE `pduPing` y no debajo: su unico consumidor es el bucle
// de medicion de `pduPing`. Igual que `DESPIERTA_COLA_DIALOGO`, declararlas antes
// de su uso quita la dependencia del orden de evaluacion del fichero: si un motor
// las leyera como `undefined`, el bucle no avanzaria ni un paso y el ping saliera
// "sin veredicto" sin decir por que.
var PDU_PASOS_MAXIMOS = 40;
var PDU_ESPERA_PASO_MS = 100;
// Tope de frames que se guardan en el payload (para el veredicto y el `output`).
var PDU_LIMITE_PASO = 60;

// Ping ICMP de `sourceName` a `targetName` por PDU. Mismo contrato de payload
// que el ping por CLI (para que el backend no necesite cambios):
//   {success, ok, metodo:"pdu", source, target, protocol, sourceIp, targetIp,
//    sent, received, lossPercent, rttAvg, status, output, ...extras}
// con `status` en: ok | no_reply | unsupported_device | source_not_found |
// target_not_found | no_ip | command_failed | interfaz_no_lista. `no_reply`
// sigue cubriendo tanto el PDU descartado como el inconcluso (difieren en el
// texto de `output`). `interfaz_no_lista` es el estado NUEVO del pre-flight de
// interfaces: el PDU NO se creo porque un enlace no estaba operativo todavia
// (transitorio, no dice NADA de la topologia ni del destino).
//
// SECUENCIA (la que impone la medicion real):
//   pre-validado (equipos / tipo / IP) -> PRE-FLIGHT DE INTERFACES (esperar a que
//   `isPortUp()` del origen y del destino sea true) -> API de PDU -> ENTRAR en
//   simulacion -> BUCLE DE MEDICION (reset + `addSimplePdu` + `forward()` +
//   veredicto, y UN reintento si el PDU no salio del origen) -> RESTAURAR el modo
//   en el `finally`. El pre-validado NO toca el modo a proposito: si falla, PT se
//   queda como estaba y el hibrido cae a `__pingCli`. El reintento del PDU esta
//   documentado y presupuestado en "REINTENTO DEL PDU CUANDO NO SALIO DEL
//   ORIGEN", justo encima de esta funcion.
//
// Campos ADITIVOS del modo (para que la suite pueda verificar que el ping no
// deja PT en simulacion): `modoPrevio`, `modoEntrada`, `modoRestaurado`,
// `resetSimulacion`, `filtroDispositivos`, `framesPareja`, `framesAjenos`,
// `descartadoEn` y `aviso`.
// Campos ADITIVOS del pre-flight de interfaces: `interfacesEsperadas` (ms que se
// espero de verdad), `interfacesComprobadas` (intentos), `interfacesListas`,
// `estadoInterfazDesconocida`, `estadoInterfazOrigen`, `estadoInterfazDestino`.
// Campos ADITIVOS del veredicto (por que se dijo que si o que no):
// `llegoAlDestino`, `volvioAlOrigen`, `viajeCompleto`, `indiceDestino`,
// `indiceOrigen`, `destinoEnCola`, `origenEnCola`, `noSalioDelOrigen`,
// `rttUnidad`, `transitViaje`.
// Campos ADITIVOS del reintento: `reintentosPdu` (0 o 1, cuantos reintentos se
// hicieron de verdad) y `reintentado` (true solo si el veredicto es del segundo
// intento).
pduPing = function (sourceName, targetName, options) {
  var opts = options && typeof options === "object" ? options : {};
  var out = __payloadPing(sourceName, targetName);
  out.metodo = "pdu";
  out.pduPendiente = false;
  // Reintento del PDU: se informan SIEMPRE, incluso en los caminos que no llegan
  // al bucle de medicion (`interfaz_no_lista`, `no_ip`, ...), para que el
  // payload tenga una forma estable y no haya que adivinar si el campo falta o
  // vale 0. `reintentado` es `true` solo si el veredicto es del segundo intento.
  out.reintentosPdu = 0;
  out.reintentado = false;

  // Estado que se restaura pase lo que pase (se limpia en el `finally`).
  var limpieza = {
    pdu: null,
    antes: -1,
    creado: false,
    borrado: false,
    sinBorrar: false, // un intento quedo sin borrar (solo con reintento)
    modoPrevio: "", // modo REAL antes de que nosotros toquemos nada
    entramos: false, // true solo si FUERON NOSOTROS los que conmutamos
    restaurado: true, // el `finally` lo pone a false si no se pudo volver
    avisos: [],
  };
  // Por defecto se considera restaurado: nada que restaurar hasta que entremos
  // en simulacion (pre-validado fallido, equipo inexistente, ...).
  out.modoRestaurado = true;
  out.modoPrevio = "";
  out.modoEntrada = "sin_cambio";

  try {
    // 1) Resolver ambos equipos. Si falta alguno no se toca NADA (ni el modo).
    var net = ipc.network();
    var origen = net.getDevice(sourceName);
    if (!origen) {
      out.status = "source_not_found";
      out.output = "Source device not found: " + sourceName;
      return out;
    }
    var destino = net.getDevice(targetName);
    if (!destino) {
      out.status = "target_not_found";
      out.output = "Destination device not found: " + targetName;
      return out;
    }

    // 2) Tipo de equipo: hay que descartar los que no admiten PDU ANTES de
    //    tocar `addSimplePdu` (un sensor IoT no tiene donde enviar el ICMP).
    var tipoOrigen = __admitePdu(origen);
    if (!tipoOrigen.ok) {
      out.status = "unsupported_device";
      out.output =
        "'" +
        sourceName +
        "' es del tipo " +
        tipoOrigen.tipo +
        ", que no admite PDU de usuario en Packet Tracer: no se puede pinguear por PDU.";
      return out;
    }
    var tipoDestino = __admitePdu(destino);
    if (!tipoDestino.ok) {
      out.status = "unsupported_device";
      out.output =
        "'" +
        targetName +
        "' es del tipo " +
        tipoDestino.tipo +
        ", que no admite PDU de usuario en Packet Tracer: no se puede pinguear por PDU.";
      return out;
    }

    // 2b) PRE-VALIDACION DE IP. Aqui es donde nacia el dialogo modal que
    //     congela PT: sin IP utilizable NO se llama a `addSimplePdu`.
    var ipDestino = __ipUtilDe(sourceName, targetName);
    if (!ipDestino) {
      out.status = "no_ip";
      out.output =
        "'" +
        targetName +
        "' no tiene ninguna IP utilizable: no se crea el PDU (llamarlo aqui " +
        "abriria el dialogo de puertos sin funcion de Packet Tracer).";
      return out;
    }
    var ipOrigen = __ipUtilDe(targetName, sourceName);
    if (!ipOrigen) {
      out.status = "no_ip";
      out.output =
        "'" +
        sourceName +
        "' no tiene ninguna IP utilizable: no se crea el PDU (llamarlo aqui " +
        "abriria el dialogo de puertos sin funcion de Packet Tracer).";
      return out;
    }
    out.sourceIp = ipOrigen;
    out.targetIp = ipDestino;

    // 2c) PRE-FLIGHT DE INTERFACES. MEDIDO en PT 9: los enlaces tardan unos
    //     segundos en levantar despues de configurar el equipo (`no shutdown` +
    //     `configurePcIp`), y un PDU creado en esa ventana se queda ENCOLA en
    //     el origen sin llegar a transmitirse nunca. El ping se quejaba entonces
    //     del DESTINO, que era un falso diagnostico (era una condicion de
    //     carrera: `reachabilityMatrix`, que repite los mismos pings despues,
    //     si pasa). Aqui se espera a que origen y destino tengan interfaz
    //     operativa (`__estadoInterfaz`: cable + `isPortUp()`) y, si no llegan
    //     dentro del presupuesto, se devuelve `interfaz_no_lista` SIN llamar a
    //     `addSimplePdu` ni a conmutar el modo de simulacion.
    var esperaInterfaz = INTERFAZ_ESPERA_MAX_MS;
    if (typeof opts.esperaInterfazMs === "number" && opts.esperaInterfazMs >= 0) {
      esperaInterfaz = Math.min(opts.esperaInterfazMs, INTERFAZ_ESPERA_MAX_MS);
    }
    var pre = __esperarInterfazLista(origen, destino, esperaInterfaz, INTERFAZ_PASO_MS);
    out.interfacesEsperadas = pre.esperaMs;
    out.interfacesComprobadas = pre.intentos;
    out.estadoInterfazOrigen = pre.origen;
    out.estadoInterfazDestino = pre.destino;
    out.estadoInterfazDesconocida = pre.desconocida;
    out.interfacesListas = pre.lista;
    // `desconocida` = la API de puertos no se puede leer: eso NO es "no esta
    // listo", asi que se sigue con el flujo actual (el banco lo verifica: sin
    // `isPortUp` el ping NO espera y NO se bloquea).
    if (!pre.desconocida && !pre.lista) {
      out.status = "interfaz_no_lista";
      out.ok = false;
      out.sent = 0;
      out.received = 0;
      out.lossPercent = 100;
      // El PDU ni se creo: nada salio del origen. Se dice explicitamente para
      // que el `output` de un `no_reply` posterior no se lea igual.
      out.noSalioDelOrigen = true;
      out.output = __mensajeInterfazNoLista(sourceName, targetName, pre, pre.esperaMs);
      return out;
    }

    var sim = ipc.simulation();
    var pdu = null;
    try {
      var app = ipc.appWindow();
      if (app && typeof app.getUserCreatedPDU === "function") pdu = app.getUserCreatedPDU();
    } catch (ePdu) {
      pdu = null;
    }
    limpieza.pdu = pdu;
    if (pdu) limpieza.antes = __contarPduUsuario(pdu);
    if (!pdu) {
      out.status = "command_failed";
      out.output =
        "Packet Tracer no expone la lista de PDUs de usuario (getUserCreatedPDU): " +
        "no se puede crear el PDU entre '" +
        sourceName +
        "' y '" +
        targetName +
        "'.";
      return out;
    }

    // 3) MODO DE SIMULACION. MEDIDO: en tiempo real el PDU no genera ni un
    //    frame, asi que hay que simular para poder medir. Se guarda el modo
    //    REAL y solo se restaura al final si lo cambiamos nosotros.
    var simPrevio = "realtime";
    try {
      simPrevio = sim.isSimulationMode() ? "simulation" : "realtime";
    } catch (eModo) {
      simPrevio = "realtime";
    }
    out.modoPrevio = simPrevio;
    limpieza.modoPrevio = simPrevio;
    if (simPrevio !== "simulation") {
      var entrada = __irASimulacion(true);
      if (!entrada || entrada.ok !== true) {
        // Sin simulacion el PDU no fluye: es un `command_failed` y el hibrido
        // cae a la via CLI (que si funciona en tiempo real).
        out.status = "command_failed";
        out.modoEntrada = "fallo";
        out.output =
          "No se pudo entrar en modo simulacion (" +
          ((entrada && entrada.motivo) || "motivo desconocido") +
          "): el PDU de Packet Tracer solo avanza en simulacion, asi que se " +
          "mide por la via de consola.";
        return out;
      }
      out.modoEntrada = entrada.via || "rsswitch";
      limpieza.entramos = true;
    }

    // BUCLE DE MEDICION. Un intento normal + (como mucho) UN reintento, y el
    // reintento existe SOLO para el caso `noSalioDelOrigen` (ver la cabecera de
    // la funcion y `__debeReintentarPdu`). Todo lo que va de aqui al final del
    // veredicto (reinicio, marcadores, `addSimplePdu`, bucle de `forward()` y
    // analisis) se repite integro en el segundo intento.
    for (var intento = 0; intento <= PDU_REINTENTOS_MAXIMOS; intento++) {
      // 4) REINICIO DE LA LINEA DE TIEMPO de la simulacion: sin esto la medicion
      //    arranca contaminada, porque los PDUs de pings anteriores siguen
      //    pendientes y avanzan con NUESTROS `forward()` (medido: el primer
      //    intento leyo 34 frames y dio el veredicto contra uno descartado en un
      //    equipo que no era de esta pareja). `resetSimulation()` NO toca la
      //    topologia ni la configuracion de los equipos (eso es `clearWorkspace`):
      //    solo frames y reloj. Desactivable con `reiniciarSimulacion:false` y
      //    *best effort*: si lanza, se sigue con un aviso.
      out.resetSimulacion = false;
      if (opts.reiniciarSimulacion !== false) {
        try {
          if (typeof sim.resetSimulation === "function") {
            sim.resetSimulation();
            out.resetSimulacion = true;
          }
        } catch (eReset) {
          limpieza.avisos.push(
            "el reinicio de la simulacion fallo (" +
              __mensajeDeError(eReset) +
              "): la medicion puede arrastrar frames de PDUs anteriores"
          );
        }
      }

      // 5) Marcadores DESPUES del reset: `antes` es el primer indice que puede
      //    ser de este PDU y `t0` su reloj de partida.
      var antes = 0;
      try {
        antes = Number(sim.getFrameInstanceCount()) || 0;
      } catch (eC) {
        antes = 0;
      }
      var t0 = 0;
      try {
        t0 = Number(sim.getCurrentSimTime()) || 0;
      } catch (eT) {
        t0 = 0;
      }

      // 6) Crear el PDU. El `creado` se marca ANTES de la llamada: si
      //    `addSimplePdu` revienta DESPUES de haber creado el escenario, el
      //    `finally` tiene que poder borrarlo igual.
      limpieza.creado = true;
      var errCode = pdu.addSimplePdu(sourceName, targetName);
      var errStr = String(errCode);
      if (errCode && errStr !== "0") {
        out.sent = 0;
        out.status = "command_failed";
        out.output =
          "Packet Tracer rechazo el PDU de '" +
          sourceName +
          "' hacia '" +
          targetName +
          "' (ADD_PDU_ERROR=" +
          errStr +
          "): no se puede medir el alcance por PDU.";
        return out;
      }

      // 7) Avance de la simulacion CON PRESUPUESTO: los frames solo se mueven con
      //    `forward()` y sin tope esto se cuelga. En cuanto hay VIAJE COMPLETO (o
      //    `accepted`, o un negativo) se para, sin esperar al techo (un ping
      //    completo son 16-34 frames, asi que hace falta margen de pasos).
      var pasos = PDU_PASOS_MAXIMOS;
      if (typeof opts.maxSteps === "number" && opts.maxSteps > 0) {
        pasos = Math.min(Math.floor(opts.maxSteps), PDU_PASOS_MAXIMOS);
      }
      var espera = PDU_ESPERA_PASO_MS;
      if (typeof opts.stepMs === "number" && opts.stepMs >= 0) {
        espera = Math.min(opts.stepMs, 1000);
      }
      var filtro = { ICMP: true };
      var lectura = { frames: [], encontrados: 0 };
      var pareja = { frames: [], descartados: 0, porDispositivo: true, negativosAjenos: 0 };
      var pasosHechos = 0;
      for (var p = 0; p < pasos; p++) {
        try {
          sim.forward();
        } catch (eFwd) {
          // el frame puede seguir siendo legible aunque PT no avance
        }
        pasosHechos = p + 1;
        var totalAhora = antes;
        try {
          totalAhora = Number(sim.getFrameInstanceCount()) || antes;
        } catch (eC2) {
          totalAhora = antes;
        }
        lectura = __framesDeRango(sim, antes, totalAhora, filtro, PDU_LIMITE_PASO);
        // 8) Solo los frames de NUESTRA pareja (origen y destino): los PDUs viejos
        //    quedan fuera y no pueden decidir el veredicto.
        pareja = __framesDePareja(lectura, sourceName, targetName);
        if (!pareja.porDispositivo) {
          // `getDevice()` no sirve: no hay nada mejor que el rango de indices, y
          // se dice en el payload en vez de ocultarlo.
          out.filtroDispositivos = false;
          limpieza.avisos.push(
            "Packet Tracer no devolvio el equipo de los frames: el veredicto se apoya solo en los indices nuevos"
          );
        } else {
          out.filtroDispositivos = true;
        }
        // ¿Veredicto ya? La señal principal es el VIAJE COMPLETO (no solo
        // `accepted`, que en PT 9 puede no aparecer nunca).
        var previo = __analisisFrames(pareja.frames, sourceName, targetName);
        if (
          previo.viajeCompleto ||
          previo.aceptadoDestino ||
          previo.aceptadoOrigen ||
          previo.aceptadoSinEquipo ||
          previo.negativo
        ) {
          break;
        }
        if (p < pasos - 1) __busyWait(espera);
      }

      // 9) Veredicto final (misma lectura del ultimo paso, ya filtrada).
      var analisis = __analisisFrames(pareja.frames, sourceName, targetName);
      // ADITIVOS: por que se dijo que si (o que no). El backend los ignora; el
      // agente y la suite los leen. `aceptado*` en BOOLEANO: en PT 9 el
      // `accepted` puede no aparecer nunca, asi que tambien sirve para ver si la
      // via por PDU se apoya en el o solo en la firma del viaje.
      out.llegoAlDestino = analisis.llegoAlDestino;
      out.volvioAlOrigen = analisis.volvioAlOrigen;
      out.viajeCompleto = analisis.viajeCompleto;
      out.aceptadoDestino = !!analisis.aceptadoDestino;
      out.aceptadoOrigen = !!analisis.aceptadoOrigen;
      out.aceptadoSinEquipo = !!analisis.aceptadoSinEquipo;
      out.indiceDestino = analisis.indiceDestino;
      out.indiceOrigen = analisis.indiceOrigen;
      out.destinoEnCola = analisis.destinoEnCola;
      out.origenEnCola = analisis.origenEnCola;
      // ADITIVO: separa "el PDU no salio del origen (su interfaz no estaba
      // operativa)" de "llego y se descarto en el destino". Con eso el `output`
      // deja de accuse al destino cuando el problema era del enlace del origen.
      out.noSalioDelOrigen = analisis.noSalioDelOrigen;
      var viaje = analisis.viajeCompleto;
      var aceptado =
        !!analisis.aceptadoDestino || !!analisis.aceptadoOrigen || !!analisis.aceptadoSinEquipo;
      var veredicto = viaje || aceptado ? "ok" : analisis.negativo ? "no_reply" : "";

      var tFin = 0;
      try {
        tFin = Number(sim.getCurrentSimTime()) || 0;
      } catch (eTF) {
        tFin = 0;
      }

      out.sent = 1;
      out.ok = veredicto === "ok";
      out.received = out.ok ? 1 : 0;
      out.lossPercent = out.ok ? 0 : 100;
      out.steps = pasosHechos;
      out.framesVistos = lectura.encontrados;
      out.framesPareja = pareja.frames.length;
      out.framesAjenos = pareja.descartados;
      out.descartadoEn = "";

      // RTT: del RELOJ DE SIMULACION, nunca de `getTransitTime()`. MEDIDO en PT 9,
      // `transitTime` vale 0 o 1 y son unidades de simulacion (no ms), asi que
      // ponerlo en `rttAvg` se leeria como milisegundos. El reloj de simulacion
      // avanza con cada `forward()` y su diferencia mide el viaje; si no es
      // utilizable, `rttAvg:0` + `rttFuente:"sin_dato"` (nunca un numero inventado).
      var rtt = 0;
      var fuenteRtt = "sin_dato";
      if (out.ok && tFin > t0) {
        rtt = tFin - t0;
        fuenteRtt = "simTime";
      }
      out.rttAvg = rtt;
      out.rttFuente = fuenteRtt;
      // ADITIVO: deja explicito que el numero NO es milisegundos.
      out.rttUnidad = "reloj_simulacion_pt";
      // ADITIVO: el `transitTime` de los DOS frames de la firma del viaje (suma).
      // Son unidades de simulacion: informativo, no es el RTT.
      var transitViaje = 0;
      if (viaje) {
        var ttDestino = __transitDe(analisis.indiceDestino, pareja.frames);
        var ttOrigen = __transitDe(analisis.indiceOrigen, pareja.frames);
        if (ttDestino >= 0) transitViaje += ttDestino;
        if (ttOrigen >= 0) transitViaje += ttOrigen;
      }
      out.transitViaje = transitViaje;

      var textoRtt =
        fuenteRtt === "simTime"
          ? ", RTT de simulación " +
            rtt +
            " unidades del reloj de Packet Tracer (no son ms)"
          : ", sin RTT utilizable (rttFuente: sin_dato)";

      var ruido = "";
      if (pareja.descartados > 0) {
        ruido =
          ", " +
          pareja.descartados +
          " frame(s) de otros equipos descartados" +
          (pareja.negativosAjenos > 0
            ? " (" + pareja.negativosAjenos + " se cayeron por el camino, no se atribuyen a este PDU)"
            : "");
      }

      if (veredicto === "ok") {
        out.status = "ok";
        // El `output` dice POR QUE se dijo que si: la firma del viaje (con los
        // indices que la prueban) o, si no hubo viaje, el `accepted` que la dio.
        var entrega = "";
        if (viaje) {
          entrega =
            ", viaje de ida y vuelta completo: entregado en " +
            targetName +
            " (frame " +
            analisis.indiceDestino +
            ") y la respuesta volvió a " +
            sourceName +
            " (frame " +
            analisis.indiceOrigen +
            ")";
        } else if (analisis.aceptadoDestino) {
          entrega =
            ", entregado en " +
            targetName +
            " y aceptado allí (frame " +
            __indiceDe(analisis.aceptadoDestino, 0) +
            ")";
        } else if (analisis.aceptadoOrigen) {
          entrega =
            ", la respuesta volvió a " +
            sourceName +
            " y fue aceptada (frame " +
            __indiceDe(analisis.aceptadoOrigen, 0) +
            ")";
        } else {
          entrega = ", entregado (Packet Tracer no identifica el equipo que lo acepta)";
        }
        out.output =
          "PDU ICMP " +
          sourceName +
          " -> " +
          targetName +
          ": " +
          pareja.frames.length +
          " frame(s) de ICMP" +
          entrega +
          " (sim " +
          tFin +
          ")" +
          textoRtt +
          ruido;
      } else if (veredicto === "no_reply") {
        out.status = "no_reply";
        var en = analisis.negativoEn;
        if (en === String(sourceName)) out.descartadoEn = "origen";
        else if (en === String(targetName)) out.descartadoEn = "destino";
        else if (en) out.descartadoEn = "intermedio";
        var donde =
          out.descartadoEn === "origen"
            ? "el PDU no llegó a salir de " + sourceName
            : "descartado en " + (en || String(targetName));
        // El PDU murio en el ORIGEN: la causa es su interfaz, y decir "el equipo
        // destino no responde" es MENTIRA (no se sabe nada del destino). Solo en
        // ese caso se nombra el enlace del origen.
        var causa =
          out.descartadoEn === "origen"
            ? "el PDU se quedo encolado en " +
              sourceName +
              " y su interfaz no estaba operativa (el enlace todavia no habia levantado): el problema es del ENLACE del ORIGEN, no del destino ni de la topologia, asi que no cambies la configuracion de " +
              targetName +
              ": espera unos segundos y repite el ping" +
              __colaDelReintento(out)
            : "el equipo destino no responde";
        out.output =
          "PDU ICMP " +
          sourceName +
          " -> " +
          targetName +
          ": " +
          pareja.frames.length +
          " frame(s) de ICMP, " +
          donde +
          " (sim " +
          tFin +
          "): " +
          causa +
          ruido;
      } else {
        out.status = "no_reply";
        // INCONCLUSO: nunca `ok`. Aqui se explica DONDE se quedo, que es lo que
        // permite a la suite y al agente distinguir "no llego" de "no se pudo
        // afirmar" (un `buffered` sigue en cola: no cuenta ni como llegada ni
        // como retorno).
        var porque = "";
        if (analisis.noSalioDelOrigen) {
          // Ningun frame salio del origen: la causa es su INTERFAZ. El
          // conservadorismo ("sin veredicto" / "no se puede afirmar") se mantiene,
          // pero la causa ya no se le echa al destino.
          porque =
            "; el PDU no llegó a salir de " +
            sourceName +
            ": su interfaz no estaba operativa y se quedo encolado en el origen. El problema es del ENLACE del origen, NO del destino ni de la topologia, asi que no cambies la configuracion de " +
            targetName +
            ": espera unos segundos y repite el ping" +
            __colaDelReintento(out);
        } else if (analisis.llegoAlDestino) {
          porque =
            "; el PDU llegó a " +
            targetName +
            " (frame " +
            analisis.indiceDestino +
            ") pero no se vio la respuesta volver a " +
            sourceName;
        } else if (analisis.destinoEnCola) {
          porque = "; en " + targetName + " solo hay frames aún en cola";
        }
        if (analisis.origenEnCola) {
          porque += " (en " + sourceName + " hay frames aún en cola)";
        }
        out.output =
          "PDU ICMP " +
          sourceName +
          " -> " +
          targetName +
          ": sin veredicto tras " +
          pasosHechos +
          " paso(s) de simulación (" +
          pareja.frames.length +
          " frame(s) de ICMP de la pareja sin llegar ni caerse" +
          ruido +
          "): el PDU no completó" +
          porque +
          ". No se puede afirmar alcance por PDU.";
      }

      // B) DECISION DEL REINTENTO. Solo se reintenta cuando el PDU NO salio del
      //    origen (ver `__debeReintentarPdu`): en ese caso no se transmitio NADA, y
      //    por tanto no produjo ningun efecto, asi que volver a enviarlo no puede
      //    duplicar nada. Aqui NO se reintenta en ningun otro caso, y en particular
      //    no cuando el PDU salio (llego, se cayo o quedo en cola): ahi ya hubo
      //    transmision y repetir la medicion solo gastaria presupuesto.
      if (!__debeReintentarPdu(intento, out)) break;

      // B1) Espera antes de reintentar: el enlace del ORIGEN es lo que tiene que
      //     levantarse (ver `PDU_REINTENTO_ESPERA_MS` y el calculo de presupuesto).
      __busyWait(__esperaDelReintento(opts));

      // B2) El escenario de PDU del intento fallido se borra ANTES de crear el
      //     siguiente. Con el mismo criterio cautiouso del `finally`: solo si el
      //     contador de PT existe, solo si ha crecido EXACTAMENTE en 1 (si no, el
      //     indice no es fiable y no se borra nada) y solo si PT dice que ese
      //     indice es el que creamos nosotros.
      //     `antes` se vuelve a leer DESPUES de borrar: con el recuento previo
      //     quedaria desfasado en uno, el siguiente `addSimplePdu` crearia el
      //     indice `antes + 1` y el `finally` no borraria nada (dejaria un
      //     escenario vivo y marcaria `pduPendiente` sin motivo).
      //     Sin API de contador (`antes < 0`) no se toca nada: se avisa con
      //     `pduPendiente:true` como hasta ahora.
      if (limpieza.creado && limpieza.pdu && limpieza.antes >= 0) {
        var cuenta = __contarPduUsuario(limpieza.pdu);
        if (cuenta === limpieza.antes + 1) {
          if (!__borrarPduUsuario(limpieza.pdu, limpieza.antes)) limpieza.sinBorrar = true;
        } else {
          limpieza.sinBorrar = true;
        }
        limpieza.antes = Math.max(0, __contarPduUsuario(limpieza.pdu));
      }

      // B3) Contador visible en el payload (`reintentosPdu`), y `reintentado:true`
      //     para quien quiera distinguir "salio a la primera" de "salio al reintento".
      out.reintentosPdu = intento + 1;
      out.reintentado = true;
    }
    return out;
  } catch (error) {
    // Se mantiene la FORMA del payload de ping (success:true) en vez de
    // devolver `fail()`: el backend espera el contrato del ping y traduce el
    // `status` de error con PING_ESTADOS_DE_ERROR.
    out.ok = false;
    out.sent = 0;
    out.received = 0;
    out.lossPercent = 100;
    out.status = "command_failed";
    out.output =
      "El ping por PDU entre '" +
      sourceName +
      "' y '" +
      targetName +
      "' fallo de forma inesperada: " +
      __mensajeDeError(error);
    return out;
  } finally {
    // 10) MODO DE SIMULACION, restaurado SIEMPRE que lo cambiemos nosotros
    //     (incluso si algo lanzo a mitad). Un fallo aqui NO enmascara el error
    //     original: se anade como aviso en el payload.
    try {
      if (limpieza.entramos && limpieza.modoPrevio === "realtime") {
        var vuelta = __irASimulacion(false);
        if (!vuelta || vuelta.ok !== true) {
          limpieza.restaurado = false;
          limpieza.avisos.push(
            "Packet Tracer quedó en modo simulación y no se pudo volver a tiempo real (" +
              ((vuelta && vuelta.motivo) || "motivo desconocido") +
              ")"
          );
        }
      }
      out.modoRestaurado = limpieza.restaurado;
      if (limpieza.avisos.length) out.aviso = limpieza.avisos.join(" | ");
    } catch (eModoFin) {
      // el `finally` nunca puede romper el ping
    }
    // Escenario de PDU, tambien siempre. El indice solo se usa si el contador
    // de PT existe y ha crecido EXACTAMENTE en 1: borrar el escenario
    // equivocado seria peor que dejar la entrada (que se limpia desde la UI).
    // `sinBorrar` recoge el caso del REINTENTO: si el escenario del intento
    // fallido no se pudo borrar antes de crear el siguiente, queda una entrada
    // mas en la lista y el payload lo dice con `pduPendiente:true`.
    try {
      if (limpieza.creado && limpieza.pdu && limpieza.antes >= 0) {
        var despues = __contarPduUsuario(limpieza.pdu);
        if (despues === limpieza.antes + 1) {
          limpieza.borrado = __borrarPduUsuario(limpieza.pdu, limpieza.antes);
        }
      }
      if (limpieza.creado && (!limpieza.borrado || limpieza.sinBorrar)) out.pduPendiente = true;
    } catch (eFin) {
      // el `finally` nunca puede romper el ping
    }
  }
};

// ---------------------------------------------------------------------------
// PING POR CLI EN TIEMPO REAL (respaldo de la via PDU)
//
// Ejecuta `ping <ip>` en la consola IOS con runDeviceCommands. Solo se llega
// aqui cuando el PDU no es viable (sin IP, tipo sin PDU, `addSimplePdu`
// rechazado o frames sin veredicto), y entonces se arrastra toda la problematica
// de la consola: dialogo inicial, pantalla de arranque, lookup DNS, corte de
// buffer y comando mutilado. `__despertarConsola` y `__corte` (usados mas
// abajo) son los que la esquivan.
// ---------------------------------------------------------------------------

// Ping ICMP de `sourceName` a `targetName` por CLI en tiempo real.
// `options` solo lee `waitMs` (espera inicial de la consola, 1200 ms) y
// `pollMs` (espera maxima adicional a que IOS cierre el ping, 6000 ms); las
// opciones antiguas (maxSteps/protocol) ya no aplican porque no hay simulacion.
// Contrato de la respuesta:
//   {success, ok, metodo:"cli", source, target, reversed, protocol, sourceIp,
//    targetIp, sent, received, lossPercent, rttAvg, status, output}
// con status en: ok | no_reply | unsupported_device | source_not_found |
// target_not_found | no_ip | command_failed | console_blocked.
//
// QUE IP SE PINGA Y QUIEN EMITE (importa para leer `targetIp`):
//   * Caso normal (origen con consola IOS): el ping sale SIEMPRE desde
//     `sourceName` hacia la IP de `targetName` (la interfaz del destino conectada
//     al origen y, si esa no tiene IP, cualquier otra IP del destino).
//     `reversed:false` y `targetIp` = IP del destino.
//   * Origen SIN consola IOS (PC/Server/Laptop): un host no puede ejecutar
//     `ping` por CLI, asi que SOLO si el destino tiene consola IOS se invierte
//     el envio (`reversed:true`): el que emite es `targetName` y `targetIp` pasa
//     a ser la IP de `sourceName`, que es la direccion a la que realmente se le
//     hace ping. `source`/`target` de la respuesta NUNCA se intercambian.
//     ESTA INVERSION ES SOLO DE LA VIA CLI: el PDU acepta cualquier equipo como
//     emisor, asi que por PDU `reversed` siempre es false.
//   * Origen sin CLI IOS y destino tampoco -> `status:"unsupported_device"` sin
//     intentar nada raro.
//   * Consola del emisor bloqueada (dialogo inicial, pantalla de arranque o
//     bloqueo DNS por un `no` colado como hostname) -> `status:"console_blocked"`
//     en vez de un `command_failed` generico.
__pingCli = function (sourceName, targetName, options) {
  try {
    var opts = options || {};
    var out = __payloadPing(sourceName, targetName);
    out.metodo = "cli";
    var net = ipc.network();

    var origen = net.getDevice(sourceName);
    if (!origen) {
      out.status = "source_not_found";
      out.output = "Source device not found: " + sourceName;
      return out;
    }
    var destino = net.getDevice(targetName);
    if (!destino) {
      out.status = "target_not_found";
      out.output = "Destination device not found: " + targetName;
      return out;
    }

    var modoOrigen = __defaultMode(origen);
    var modoDestino = __defaultMode(destino);

    // IP pingada por defecto: la del objetivo, calculada desde el origen.
    var invertido = false;
    var emisor = sourceName;
    var receptor = targetName;
    var ipPing = __ipParaPing(sourceName, targetName);

    if (modoOrigen !== "enable") {
      // El origen no tiene consola IOS: no puede ejecutar `ping` por CLI.
      if (modoDestino !== "enable") {
        out.status = "unsupported_device";
        out.output =
          "'" +
          sourceName +
          "' no tiene consola IOS (modo '" +
          modoOrigen +
          "') y '" +
          targetName +
          "' tampoco (modo '" +
          modoDestino +
          "'): no hay ningun equipo desde el que ejecutar 'ping'. Usa un router o un switch como origen o destino.";
        return out;
      }
      // Solo entonces se invierte: emite el destino y el objetivo es la IP del
      // origen (ver la cabecera de esta funcion).
      invertido = true;
      emisor = targetName;
      receptor = sourceName;
      ipPing = __ipParaPing(targetName, sourceName);
    }

    if (!ipPing || __ipToLong(ipPing) === null) {
      out.status = "no_ip";
      out.output =
        "Sin IP valida para hacer ping a '" +
        receptor +
        "': ni la interfaz conectada a '" +
        emisor +
        "' ni ninguna otra direccion del equipo.";
      return out;
    }
    out.targetIp = ipPing;
    if (invertido) out.reversed = true;
    // IP del emisor real: solo informativo (el backend no lo lee).
    out.sourceIp = __ipUtilDe(receptor, emisor);

    var equipoEmisor = invertido ? destino : origen;
    var modoEmisor = __defaultMode(equipoEmisor);
    if (modoEmisor !== "enable") {
      // Red de seguridad: no deberia pasar (el emisor siempre tiene CLI IOS).
      out.status = "unsupported_device";
      out.output =
        "'" +
        emisor +
        "' no tiene consola IOS (modo '" +
        modoEmisor +
        "') y no puede ejecutar 'ping' por CLI. Usa un router o un switch como origen o destino.";
      return out;
    }

    // Consola del emisor: guardamos la salida previa para poder esperar a que
    // IOS termine el ping (la respuesta llega en varias lecturas de getOutput).
    var espera = typeof opts.waitMs === "number" && opts.waitMs >= 0 ? opts.waitMs : 1200;
    var linea = __resolveLine(equipoEmisor);

    // Despertamos la consola ANTES de capturar `antes`: si no, el texto del
    // dialogo inicial entraria en el slice del bucle de sondeo de mas abajo.
    // (runDeviceCommands repite la llamada, pero ya no encuentra nada
    // pendiente: es la misma funcion compartida, sin logica duplicada.)
    var despertar = __despertarConsola(linea, equipoEmisor, espera);

    // Consola del emisor lista para enviar el `ping`? El despertar ya espero
    // por ESTADO OBSERVABLE (prompt estable / deadline de arranque), asi que
    // aqui solo se CONFIRMA: si devuelve ok:true Y hay prompt, el ping se
    // envia. Solo se bloquea (`console_blocked`) si sigue sin prompt, o si el
    // lookup DNS sigue en marcha pese a los `\u001e`.
    var motivoPrevio = "";
    if (despertar && despertar.ok === true && (__promptActual(linea) || despertar.motivo === "no_ios")) {
      motivoPrevio = "";
    } else if (despertar && despertar.motivo === "bloqueo_dns_translating") {
      motivoPrevio = "bloqueo_dns";
    } else if (despertar && despertar.motivo && despertar.motivo !== "no_ios") {
      // Motivo concreto del despertar (p. ej. "arranque_incompleto"): mucho mas
      // util que un "command_failed" generico, y sigue siendo un codigo corto
      // en espanol sin las frases en ingles que la suite test-pt usa como
      // marcador de consola sucia.
      motivoPrevio = despertar.motivo;
    } else {
      motivoPrevio = __motivoConsolaBloqueada(linea, "");
    }
    if (motivoPrevio) {
      out.status = "console_blocked";
      out.output =
        "La consola de '" +
        emisor +
        "' esta bloqueada (" +
        motivoPrevio +
        "): no se envia 'ping " +
        ipPing +
        "' para no empeorar el bloqueo.";
      return out;
    }

    var antes = "";
    if (linea && linea.getOutput !== undefined) antes = String(linea.getOutput() || "");

    // El `ping` NO se teclea aqui a mano: lo delega en runDeviceCommands, que ya
    // espera a que la consola este inactiva antes de cada comando (mismo cuidado
    // que en el resto del motor, sin duplicar la logica).
    var ejecucion = runDeviceCommands(emisor, ["ping " + ipPing], { mode: "enable", waitMs: espera });
    if (!ejecucion || ejecucion.success === false) {
      out.status = "command_failed";
      out.output =
        (ejecucion && ejecucion.error) ||
        "No se pudo ejecutar 'ping " + ipPing + "' en '" + emisor + "'.";
      return out;
    }

    var fila = ejecucion.results && ejecucion.results.length ? ejecucion.results[0] : null;
    var salida = fila ? String(fila.output || "") : "";
    var parseo = __parsearPing(salida);

    // Un ping sin ruta tarda hasta 5 timeouts de 2 s: esperamos de forma
    // acotada (pollMs) a que IOS escriba la linea "Success rate is ...".
    // Cada sondeo vuelve a cortar con `__corte` y el eco del `ping` como ancla:
    // el buffer de PT es acotado y, si se desborda mientras llega la respuesta,
    // el corte por snapshot devolveria el buffer entero (con el banner de
    // arranque) en vez de la salida del ping.
    var anclaPing = "ping " + ipPing;
    var pollMs = typeof opts.pollMs === "number" && opts.pollMs >= 0 ? opts.pollMs : 6000;
    var limite = Date.now() + pollMs;
    var cortePing = null;
    while (!parseo && linea && linea.getOutput !== undefined && Date.now() < limite) {
      __busyWait(400);
      cortePing = __corte(String(linea.getOutput() || ""), antes, anclaPing);
      salida = cortePing.texto;
      if (salida.length > 4000) salida = salida.substring(salida.length - 4000);
      parseo = __parsearPing(salida);
    }

    // Corte degradado en el sondeo: la salida del ping no es del todo de fiar.
    // Se marca en el payload (codigo corto en espanol) para que se vea.
    if (cortePing && !cortePing.limpio) out.corte = "degradado";

    out.output = salida;
    if (!parseo) {
      // Si la consola esta colgada el ping no llego a ejecutarse: status claro.
      // El diagnostico se busca en este orden: marcas en la propia salida del
      // ping, motivo del despertar de runDeviceCommands (p. ej. el arranque a
      // medias) y, por ultimo, el estado del buffer.
      var motivoBloqueo = __motivoConsolaBloqueada(linea, salida);
      if (!motivoBloqueo && ejecucion.despertar && ejecucion.despertar.motivo) {
        motivoBloqueo = ejecucion.despertar.motivo;
      }
      if (motivoBloqueo) {
        out.status = "console_blocked";
        out.output =
          "La consola de '" +
          emisor +
          "' esta bloqueada (" +
          motivoBloqueo +
          "): 'ping " +
          ipPing +
          "' no llego a ejecutarse." +
          (salida ? "\n" + salida.slice(0, 400) : "");
        return out;
      }
      out.status = "command_failed";
      if (!salida) {
        out.output = ejecucion.warning
          ? "Sin salida legible de '" + emisor + "' (" + ejecucion.warning + ") para 'ping " + ipPing + "'."
          : "El comando 'ping " + ipPing + "' no produjo salida de IOS en '" + emisor + "'.";
      }
      return out;
    }

    out.ok = parseo.ok;
    out.sent = parseo.enviados;
    out.received = parseo.recibidos;
    out.lossPercent = parseo.perdida;
    out.rttAvg = parseo.rtt;
    out.status = parseo.ok ? "ok" : "no_reply";
    return out;
  } catch (error) {
    return fail("Error pingDevices (CLI)", error);
  }
};

// ---------------------------------------------------------------------------
// PING HIBRIDO: PDU primero, CLI de respaldo.
//
// Politica (decidida, no arbitraria):
//   1. `options.metodo:"cli"` fuerza la via CLI (util para depurar).
//   2. Si no, se intenta `pduPing`.
//      * `ok` o `no_reply` CON veredicto -> se respeta: el PDU es la via
//        oficial y su veredicto es la medicion; la consola no puede mejorarlo.
//      * `no_reply` por PDU -> se prueba ademas el sentido contrario
//        (destino -> origen) para distinguir "caido" de "no responde en ese
//        sentido". Solo se anade `reversoOk` si el otro sentido SI responde, que
//        es el caso que aporta informacion nueva.
//      * `interfaz_no_lista` (el PDU ni se creo: un enlace del equipo no estaba
//        operativo todavia) -> se devuelve DIRECTO, sin sonda en sentido
//        contrario y sinvia CLI: el mensaje "el problema es de un solo sentido"
//        seria contradictorio y el ping por CLI fallaria por el mismo enlace.
//      * `no_ip` / `unsupported_device` / `command_failed` (tampoco se pudo
//        entrar en simulacion) / inconcluso -> el PDU no era viable: se cae a
//        la via CLI, que es la de siempre y si funciona en tiempo real.
//   3. La INVERSION del ping (`reversed`) es SOLO de la via CLI: el PDU acepta
//      cualquier equipo como emisor, asi que por PDU `reversed` es siempre
//      false. Si el respaldo es por CLI y ahi hizo falta inverter, el payload
//      lo refleja (`reversed:true` + `metodo:"cli"`).
//   4. `pduPing` ENTRA en modo simulacion y sale en su `finally`, asi que cada
//      intento (el del sentido normal y el de la sonda en sentido contrario)
//      deja PT en el modo que tenia. `modoRestaurado` viaja en el payload para
//      que la suite pueda comprobarlo; si el PDU no pudo simular devuelve
//      `command_failed` y aqui cae a la via CLI, que si funciona en tiempo real.
pingDevices = function (sourceName, targetName, options) {
  try {
    var opts = options && typeof options === "object" ? options : {};
    var pedido = typeof opts.metodo === "string" ? opts.metodo.toLowerCase() : "";

    if (pedido !== "cli") {
      var porPdu = pduPing(sourceName, targetName, opts);
      if (porPdu && porPdu.status) {
        if (porPdu.status === "ok" || porPdu.status === "no_reply") {
          if (porPdu.status === "no_reply" && opts.probarReverso !== false) {
            // Sonda en sentido contrario. Entra y sale de simulacion por su
            // cuenta (`pduPing`), asi que no acumula modos: el `finally` del
            // primer intento ya devolvio PT al modo original.
            var reverso = pduPing(targetName, sourceName, opts);
            if (reverso && reverso.ok === true) {
              porPdu.reversoOk = true;
              porPdu.output =
                porPdu.output +
                " El sentido contrario (" +
                targetName +
                " -> " +
                sourceName +
                ") SI responde: el problema es de un solo sentido, no una caida.";
            }
            // La sonda es informativa: si dejo PT en simulacion, se avisa.
            if (reverso && reverso.modoRestaurado === false) porPdu.modoRestaurado = false;
          }
          return porPdu;
        }
        // `interfaz_no_lista`: el PDU NO se creo porque un ENLACE del equipo no
        // estaba operativo todavia. Se devuelve DIRECTO, por dos razones:
        //   * NO se sondea el sentido contrario: su `reversoOk:true` anadiria
        //     "el problema es de un solo sentido", que CONTRADICE al estado
        //     (no es un problema de direccion, es un enlace recien configurado
        //     que aun no ha levantado).
        //   * NO se cae a la via CLI: en tiempo real el ping por CLI daria 100%
        //     de perdida por el MISMO enlace, y ademas la consola diria "no
        //     responde", que es justo el falso diagnostico que se quiere evitar.
        if (porPdu.status === "interfaz_no_lista") {
          return porPdu;
        }
        // resto de estados (no_ip / unsupported_device / command_failed /
        // source_not_found / target_not_found): se decide mas abajo.
        if (porPdu.status === "source_not_found" || porPdu.status === "target_not_found") {
          // El equipo no existe: la CLI daria exactamente lo mismo, asi que se
          // devuelve directamente sin gastar la consola.
          return porPdu;
        }
      }
    }

    // Cualquier otro caso (`no_ip`, `unsupported_device`, `command_failed` --no
    // se pudo entrar en simulacion, PDU rechazado, excepcion--) cae aqui: el PDU
    // no era viable y la consola es la via de siempre.
    var porCli = __pingCli(sourceName, targetName, opts);
    // Campo aditivo y unico para verificar el modo desde fuera, tambien en la
    // via de respaldo (la CLI no toca el modo, asi que queda en true).
    if (porCli && typeof porCli === "object" && porCli.modoRestaurado === undefined) {
      porCli.modoRestaurado = true;
    }
    return porCli;
  } catch (error) {
    return fail("Error pingDevices", error);
  }
};

// Matriz de alcanzabilidad: bucle sobre pingDevices (maximo 10 destinos), que
// ya es hibrido (PDU primero, CLI de respaldo). `metodo` por fila es
// ADITITIVO: el backend solo lee target/ok/received/lossPercent/status, asi que
// la forma no cambia. `modoRestaurado` por fila tambien es aditivo, y sirve para
// comprobar que los pings seguidos NO acumulan estado: cada `pduPing` entra en
// simulacion con `resetSimulation()`, mide y sale en su `finally`, asi que la
// fila siguiente arranca desde un estado conocido (frames limpios, reloj a 0 y
// el modo original).
reachabilityMatrix = function (sourceName, targetNames) {
  try {
    if (!Array.isArray(targetNames)) {
      return { success: false, error: "targetNames debe ser un array" };
    }
    if (!ipc.network().getDevice(sourceName)) {
      return { success: false, error: "Source device not found: " + sourceName };
    }

    var limit = Math.min(targetNames.length, 10);
    var rows = [];
    for (var i = 0; i < limit; i++) {
      var target = String(targetNames[i]);
      // Presupuesto por destino: con 10 filas no podemos permitirnos el techo
      // completo de pingDevices dentro del timeout del backend (el `maxSteps`
      // acota el peor caso de la via PDU). 30 pasos x 100 ms = 3 s por fila, el
      // MISMO peor caso que antes (20 x 150 ms) con un 50% mas de margen para
      // que la respuesta de vuelta quepa. Y el sondeo en sentido contrario se
      // desactiva aqui (`probarReverso:false`): duplicaria el coste de cada fila
      // sin aportar nada al objetivo de la matriz.
      //
      // `esperaInterfazMs` (pre-flight) y `reintentoEsperaMs` (espera del
      // reintento del PDU) estan recortados porque las filas se ejecutan EN
      // SERIE y el origen es el MISMO para todas: el enlace, si no levanta,
      // levanta mientras las filas anteriores se median. Con un reintento por
      // fila el peor caso es
      //   10 x (1,2 s de pre-flight + 3 s de pasos + 0,4 s de espera + 3 s de
      //   pasos) = 76 s,
      // por debajo de los 90 s de `TIMEOUT_POR_HERRAMIENTA` (con los 3 s de
      // pre-flight que tenia antes, y sin recorte de la espera de reintento, se
      // iria a 10 x 10,6 = 106 s: por eso hay que recortarlos). En el caso
      // normal (enlaces ya levantados) el pre-flight no espera NADA y su coste
      // es 0, y el reintento tampoco llega a usarse.
      var probe =
        pingDevices(sourceName, target, {
          waitMs: 700,
          pollMs: 2500,
          probarReverso: false,
          maxSteps: 30,
          esperaInterfazMs: 1500,
          reintentoEsperaMs: 400,
        }) || {};
      rows.push({
        target: target,
        ok: probe.ok === true,
        received: probe.received || 0,
        lossPercent: probe.lossPercent || 0,
        status: probe.status || "command_failed",
        metodo: probe.metodo || "cli",
        modoRestaurado: probe.modoRestaurado !== false,
        noSalioDelOrigen: probe.noSalioDelOrigen === true,
      });
    }

    return { success: true, source: sourceName, rows: rows };
  } catch (error) {
    return fail("Error reachabilityMatrix", error);
  }
};

// ---------------------------------------------------------------------------
// Inventario de modelos / modulos / configuracion del equipo.
// ---------------------------------------------------------------------------
listDeviceModels = function () {
  try {
    var models = [];
    for (var id in allDeviceTypes) {
      if (!Object.prototype.hasOwnProperty.call(allDeviceTypes, id)) continue;
      models.push({ id: id, label: id, category: "" });
    }
    return { success: true, build: EXTENSION_BUILD, models: models };
  } catch (error) {
    return fail("Error listing device models", error);
  }
};

listDeviceModules = function (deviceName) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: `Device ${deviceName} not found` };
    }

    var modules = [];
    try {
      modules = __vectorToArray(device.getSupportedModule());
    } catch (eModules) {
      return {
        success: true,
        deviceName: deviceName,
        modules: [],
        warning: "get_supported_module_unavailable",
      };
    }

    return { success: true, deviceName: deviceName, modules: modules };
  } catch (error) {
    return fail("Error listing device modules", error);
  }
};

// Limpia la salida de un `show ...-config`: quita el eco del comando (con o sin
// prompt), el banner de PT ("Building configuration..."), los avisos `% ...`,
// el prompt final y la linea `end`. Conserva el resto (lineas `!` e
// indentacion) tal cual, porque eso es lo que se guarda como snapshot.
function __limpiarConfig(salida, cmd) {
  var texto = salida === undefined || salida === null ? "" : String(salida);
  var lineas = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  var utiles = [];
  for (var i = 0; i < lineas.length; i++) {
    var linea = lineas[i];
    var t = linea.trim();
    if (!t) continue;
    // Eco del comando: "show running-config" o "R1#show running-config".
    if (t.slice(-cmd.length) === cmd) continue;
    if (
      /^(Building configuration|Current configuration\s*:|Using\s+\d+\s+out of\s+\d+\s+bytes)/i.test(t)
    ) {
      continue;
    }
    if (t.charAt(0) === "%") continue;
    if (/^[A-Za-z0-9_.\-]+(\([a-z0-9 /\-]+\))?[#>]$/.test(t)) continue;
    utiles.push(linea);
  }
  while (utiles.length && !utiles[utiles.length - 1].trim()) utiles.pop();
  if (utiles.length && /^end$/i.test(utiles[utiles.length - 1].trim())) utiles.pop();
  while (utiles.length && !utiles[utiles.length - 1].trim()) utiles.pop();
  return utiles.join("\n");
}

// ¿Parece una configuracion IOS de verdad? Devuelve false para el vacio, para
// la basura del marcador `^` de "% Invalid input detected" y para texto de
// consola que no es configuracion (dialogo inicial, bloqueo DNS, pantalla de
// arranque), que es lo que se recoge cuando la consola esta sucia o bloqueada.
function __pareceConfigIOS(texto) {
  var t = texto === undefined || texto === null ? "" : String(texto);
  t = t.replace(/^\s+|\s+$/g, "");
  if (!t) return false;
  if (/^[\s\^]*$/.test(t)) return false;
  var baja = t.toLowerCase();
  if (baja.indexOf("initial configuration dialog") !== -1) return false;
  if (baja.indexOf("please answer 'yes' or 'no'") !== -1) return false;
  if (baja.indexOf("press return to get started") !== -1) return false;
  if (baja.indexOf('translating "') !== -1) return false;
  if (baja.indexOf("% invalid input detected") !== -1) return false;
  // Marcas de una config IOS (una linea por bloque, por eso anclamos a inicio
  // de linea): `!`, version, hostname, interfaces, lineas de consola, etc.
  return /(^|\n)[ \t]*(![ \t]*$|version[ \t]+\d|hostname[ \t]+\S|interface[ \t]+\S|line[ \t]+(con|vty|aux)|ip[ \t]+(address|route|route-map)|router[ \t]+\S|vlan[ \t]+\d|spanning-tree|enable[ \t]+(secret|password)|banner[ \t]|switchport[ \t])/im.test(
    t
  );
}

// Desescapa los entidades XML basicas de una linea del serializeToXml de PT.
function __desescaparXml(texto) {
  return String(texto === undefined || texto === null ? "" : texto)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");
}

// Extrae del `xml` de PT el bloque <ETIQUETA> ... </ETIQUETA> y reconstruye el
// texto una linea por cada <LINE>. Solo se recorre ese trozo del xml (puede ser
// enorme) con indexOf/substring + regex: sin DOM, que no existe en el Script
// Engine de PT.
//   {hay: bool, texto: string, vacio: bool}
// `hay=false` si la etiqueta no aparece; `vacio=true` si aparece pero sin
// lineas (p. ej. el autocontruido <STARTUPCONFIG/> de un equipo sin config).
function __configDesdeXml(xml, etiqueta) {
  var res = { hay: false, texto: "", vacio: false };
  var bruto = xml === undefined || xml === null ? "" : String(xml);
  if (!bruto) return res;

  var mAbre = new RegExp("<" + etiqueta + ">", "i").exec(bruto);
  if (!mAbre) {
    if (new RegExp("<" + etiqueta + "\\s*/>", "i").test(bruto)) {
      res.hay = true;
      res.vacio = true;
    }
    return res;
  }

  var desde = mAbre.index + mAbre[0].length;
  var mCierra = new RegExp("</" + etiqueta + ">", "i").exec(bruto.substring(desde));
  var hasta = mCierra ? desde + mCierra.index : bruto.length;
  var cuerpo = bruto.substring(desde, hasta);

  res.hay = true;
  var marcas = cuerpo.match(new RegExp("<LINE[^>]*>[\\s\\S]*?</LINE>", "gi"));
  if (!marcas || !marcas.length) {
    res.vacio = true;
    return res;
  }
  var lineas = [];
  for (var i = 0; i < marcas.length; i++) {
    var linea = marcas[i].replace(/^<LINE[^>]*>/i, "").replace(/<\/LINE>$/i, "");
    lineas.push(__desescaparXml(linea));
  }
  res.texto = lineas.join("\n");
  return res;
}

// Tope del `xml` CRUDO que viaja en el payload de `getDeviceConfigSnapshot`.
//
// POR QUE HACE FALTA. Esta es la tool que el backend ejecuta tras CADA escritura
// para verificar (camino mas caliente que tiene la extension) y `serializeToXml()`
// devuelve el xml COMPLETO del equipo: puertos, modulos, direccionamiento, config
// de cada interfaz y las dos configs. Sin tope, un equipo con 30 interfaces lleva
// cientos de KB por socket en cada verificacion, y quien lo lee (el agente) se
// come un blob que ademas no sabe interpretar.
//
// 20.000 chars es el orden de magnitud de un xml de PT de un equipo mediano (un
// 2911 con un dozen de interfaces) y esta muy por encima de lo que ocupa el
// <RUNNINGCONFIG>/<STARTUPCONFIG> util. NO es un maxChars infinito: si se supera,
// el payload lo dice (`xml_truncado`/`xml_parcial`) y el consumidor sabe que el
// xml esta PARTIDO y no puede parsearlo entero.
//
// OJO al leer el resto de la funcion: el recorte es SOLO del campo del payload.
// El fallback de configuracion (`__configDesdeXml`) usa el xml local COMPLETO, que
// es lo unico que puede, porque `indexOf` sobre un xml cortado perderia el cierre
// de la etiqueta y devolveria configuracion inventada.
var SNAPSHOT_XML_MAX_CHARS = 20000;

getDeviceConfigSnapshot = function (deviceName) {
  try {
    var device = ipc.network().getDevice(deviceName);
    if (!device) {
      return { success: false, error: `Device ${deviceName} not found` };
    }

    var startupConfig = "";
    var runningConfig = "";
    var startupLeido = true;
    var xml = "";
    var warnings = [];

    // El startup-config de PT solo refleja lo persistido con `write memory`:
    // para un equipo recien configurado por CLI viene vacio (o el metodo ni
    // existe), por eso el running-config se lee por consola mas abajo.
    try {
      var sv = device.getStartupFile();
      startupConfig = typeof sv === "string" ? sv : __vectorToArray(sv).join("\n");
    } catch (eStartup) {
      startupLeido = false;
    }

    try {
      var raw = device.serializeToXml();
      // `xml` es el COMPLETO y se queda local a proposito: de aqui saca
      // `__configDesdeXml` la config cuando la consola no sirve (mas abajo). El
      // recorte del tope se aplica SOLO al campo del payload.
      xml = raw === undefined || raw === null ? "" : String(raw);
    } catch (eXml) {
      warnings.push("xml_unavailable");
    }

    // Solo los equipos IOS (router/switch, `__defaultMode` -> "enable")
    // entienden `show ...-config`; PC/Server se saltan y se avisa sin fallar.
    if (__defaultMode(device) === "enable") {
      var comandos = ["show running-config"];
      if (!startupConfig.trim()) comandos.push("show startup-config");

      // Reutiliza el motor de comandos como funcion interna (sin tool/socket).
      var res = runDeviceCommands(deviceName, comandos, {
        mode: "enable",
        maxChars: 20000,
      });
      if (res && res.success && res.results) {
        for (var i = 0; i < res.results.length; i++) {
          var salida = __limpiarConfig(res.results[i].output, res.results[i].command);
          if (res.results[i].command === "show running-config") {
            runningConfig = salida;
          } else if (!startupConfig.trim() && salida) {
            startupConfig = salida;
          }
        }
      }
      if (res && res.warning) warnings.push(res.warning);

      // --- Fallback desde el xml de PT -------------------------------------
      // Si la lectura por consola salio vacia o con basura (consola bloqueada,
      // dialogo inicial, marcador `^` de "% Invalid input detected"), el mismo
      // objeto que ya nos trajo el xml trae la config real en
      // <RUNNINGCONFIG><LINE>...</LINE></RUNNINGCONFIG> y <STARTUPCONFIG/>.
      // El backend (`extraerConfiguracion`) lee `runningConfig`/`config`, asi
      // que rellenarlos aqui es lo que hace util el snapshot.
      //
      // OJO: aqui se usa el xml LOCAL COMPLETO, nunca el recortado del payload.
      // `__configDesdeXml` localiza `<ETIQUETA>` y su `</ETIQUETA>` con
      // `indexOf`: sobre un xml PARTIDO no encuentra el cierre y reconstruye el
      // texto con lo que hay hasta el final, que seria configuracion inventada.
      if (!__pareceConfigIOS(runningConfig)) {
        var bloqueRunning = __configDesdeXml(xml, "RUNNINGCONFIG");
        if (bloqueRunning.hay && __pareceConfigIOS(bloqueRunning.texto)) {
          runningConfig = bloqueRunning.texto;
          warnings.push("running_config_desde_xml");
        } else {
          runningConfig = "";
        }
      }
      if (!__pareceConfigIOS(startupConfig)) {
        var bloqueStartup = __configDesdeXml(xml, "STARTUPCONFIG");
        if (bloqueStartup.hay && __pareceConfigIOS(bloqueStartup.texto)) {
          startupConfig = bloqueStartup.texto;
        } else {
          startupConfig = "";
        }
      }

      if (!runningConfig) warnings.push("running_config_unavailable");
      if (!startupLeido && !startupConfig.trim()) warnings.push("startup_config_unavailable");
    } else {
      warnings.push("non_ios_device");
    }

    // El xml del payload va ACOTADO (`SNAPSHOT_XML_MAX_CHARS`): es la lectura mas
    // caliente que hace el backend (verifica tras cada escritura) y el xml entero
    // de un equipo con muchas interfaces son cientos de KB. `xml_truncado` dice
    // que se supero el tope y `xml_parcial` advierte de lo que eso implica: el
    // documento esta PARTIDO, asi que quien lo parsee no puede extraer
    // configuracion de el (use `runningConfig`/`config`, que ya vienen limpios).
    var xmlTruncado = xml.length > SNAPSHOT_XML_MAX_CHARS;
    var payload = {
      success: true,
      deviceName: deviceName,
      startupConfig: startupConfig,
      runningConfig: runningConfig,
      config: runningConfig || startupConfig,
      xml: xmlTruncado ? xml.substring(0, SNAPSHOT_XML_MAX_CHARS) : xml,
    };
    if (xmlTruncado) {
      payload.xml_truncado = true;
      payload.xml_parcial = true;
    }
    // El startup-config viene vacio cuando nadie ha hecho `write memory`
    // (o <STARTUPCONFIG/> en el xml): se marca para no confundirlo con un fallo.
    if (!String(startupConfig || "").replace(/\s+/g, "")) payload.startupEmpty = true;
    if (warnings.length) payload.warning = warnings.join(",");
    return payload;
  } catch (error) {
    return fail("Error getting device config snapshot", error);
  }
};

// Aplica un startup-config de texto linea a linea via runDeviceCommands.
applyDeviceConfig = function (deviceName, configText) {
  try {
    if (typeof configText !== "string") {
      return { success: false, error: "configText debe ser un string" };
    }

    var raw = configText.split("\n");
    var lines = [];
    for (var i = 0; i < raw.length; i++) {
      var line = raw[i].replace(/\r$/, "").trim();
      if (!line) continue;
      if (line.charAt(0) === "!") continue;
      lines.push(line);
    }

    return runDeviceCommands(deviceName, lines, { mode: "global" });
  } catch (error) {
    return fail("Error applying device config", error);
  }
};

// ---------------------------------------------------------------------------
// Workspace: limpiar / exportar / importar (.pkt)
// ---------------------------------------------------------------------------
clearWorkspace = function () {
  try {
    var app = ipc.appWindow();
    if (!app || app.fileNew === undefined) {
      return { success: false, error: "fileNew no disponible en este entorno" };
    }
    app.fileNew(false);
    return { success: true, message: "Workspace limpiado" };
  } catch (error) {
    return fail("Error clearing workspace", error);
  }
};

// Normaliza el directorio con barra final (/ o \).
function __joinDir(dir, name) {
  var base = dir ? String(dir) : "";
  if (base) {
    var last = base.charAt(base.length - 1);
    if (last !== "/" && last !== "\\") {
      base += base.indexOf("\\") !== -1 && base.indexOf("/") === -1 ? "\\" : "/";
    }
  }
  return base + name;
}

exportWorkspace = function (filename, targetDir) {
  try {
    var app = ipc.appWindow();
    var name = filename ? String(filename) : "";
    var dir = targetDir ? String(targetDir) : "";

    var defaultDir = "";
    try {
      if (app.getDefaultFileSaveLocation !== undefined) {
        var loc = app.getDefaultFileSaveLocation();
        defaultDir = loc === undefined || loc === null ? "" : String(loc);
      }
    } catch (eDir) {
      defaultDir = "";
    }
    if (!dir) dir = defaultDir;
    if (!name) name = "topologia.pkt";

    var path = __joinDir(dir, name);

    // Intento 1: guardar directamente en disco (sin dialogo)
    if (app.fileSaveAsNoPrompt !== undefined) {
      try {
        var saved = app.fileSaveAsNoPrompt(path, false);
        if (saved !== false) {
          return { success: true, saved: "file", path: path };
        }
      } catch (eSave) {
        // caemos al intento 2
      }
    }

    // Intento 2: bytes en memoria codificados a base64 a mano
    if (app.fileSaveToBytes === undefined) {
      return {
        success: false,
        error: "No se pudo exportar: fileSaveAsNoPrompt fallo y fileSaveToBytes no existe",
      };
    }
    var bytes = app.fileSaveToBytes();
    if (bytes === undefined || bytes === null) {
      return { success: false, error: "fileSaveToBytes no devolvio datos" };
    }
    var len = __byteLength(bytes);
    var b64 = __bytesToBase64(bytes, len);
    return { success: true, saved: "base64", base64: b64, bytes: len };
  } catch (error) {
    return fail("Error exporting workspace", error);
  }
};

importWorkspace = function (filename, sourcePath, base64) {
  try {
    var app = ipc.appWindow();
    var name = filename ? String(filename) : "";
    var path = sourcePath ? String(sourcePath) : "";
    var mode = "";
    var opened = false;
    var lastErr = "";

    if (path && app.fileOpen !== undefined) {
      try {
        var res = app.fileOpen(path);
        if (res !== false) {
          opened = true;
          mode = "path";
        } else {
          lastErr = "fileOpen devolvio false";
        }
      } catch (eOpen) {
        lastErr = eOpen && (eOpen.message || String(eOpen)) || "fileOpen fallo";
      }
    }

    if (!opened && base64) {
      if (app.fileOpenFromBytes === undefined) {
        return {
          success: false,
          error: "fileOpen fallo y fileOpenFromBytes no existe" + (lastErr ? " (" + lastErr + ")" : ""),
        };
      }
      var bytes = __base64ToBytes(base64);
      if (!bytes.length) {
        return { success: false, error: "base64 vacio o invalido" };
      }
      if (!name) name = "topologia.pkt";
      try {
        var res2 = app.fileOpenFromBytes(bytes, name);
        if (res2 === false) {
          return { success: false, error: "fileOpenFromBytes rechazo los datos" };
        }
        opened = true;
        mode = "base64";
      } catch (eBytes) {
        return fail("Error importing workspace (base64)", eBytes);
      }
    }

    if (!opened) {
      return {
        success: false,
        error: "No se pudo importar el workspace" + (lastErr ? ": " + lastErr : ""),
      };
    }

    if (!name && path) {
      var cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      name = cut >= 0 ? path.substring(cut + 1) : path;
    }

    var payload = { success: true, filename: name, mode: mode };
    try {
      payload.devices = ipc.network().getDeviceCount();
    } catch (eCount) {
      // sin recuento disponible: omitimos el campo
    }
    return payload;
  } catch (error) {
    return fail("Error importing workspace", error);
  }
};
