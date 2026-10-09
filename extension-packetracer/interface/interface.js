(function () {
  // ---------------------------------------------------------------------
  // DOS puentes simultaneos e independientes: el backend de Packet Tools
  // (7531) y el puente del servidor MCP (7532).
  //
  // Son DOS servidores Socket.IO distintos, no dos alias del mismo. Antes la
  // interfaz solo mantenia UN socket: para usar el otro habia que editar la URL
  // a mano, asi que el resto del tiempo la extension estaba pegada al primero y
  // el segundo se quedaba sin servicio. Ahora los dos se conectan de salida y
  // ambos siguen siendo editables desde la UI.
  //
  // Por eso TODO el estado vive DENTRO del objeto de puente: socket, estado,
  // `sid`, cola de resultados pendientes y listeners. Un fallo en uno no puede
  // tumbar ni silenciar al otro, y cada linea del log lleva la etiqueta del
  // puente al que pertenece (asi se distingue "este servidor esta caido" de
  // "el agente no llamo a la herramienta").
  //
  // Las URLs se guardan en localStorage para no recompilar el .pts. OJO: la
  // interfaz se carga con el esquema `this-sm:` de Packet Tracer y ese origen
  // puede ser opaco, en cuyo caso TODO acceso a localStorage lanza
  // SecurityError. Por eso cada lectura/escritura va envuelta en try/catch y, si
  // falla, se sigue con `puente.url`: el storage jamas debe romper la conexion.
  // ---------------------------------------------------------------------
  var STORAGE_KEY = {
    backend: "packetToolsBackendUrl",
    mcp: "packetToolsMcpUrl",
  };
  // Clave de la version de un solo puente. Aquel unico destino era el MCP
  // (7532 era su default), asi que su valor se hereda al puente MCP como
  // fallback y NO se borra (puede seguir sirviendo a una interfaz vieja).
  var STORAGE_KEY_LEGADO = "packetToolsBridgeUrl";
  var DEFAULT_URL = {
    backend: "http://127.0.0.1:7531",
    mcp: "http://127.0.0.1:7532",
  };

  var puentes = [
    {
      clave: "backend",
      etiqueta: "Backend local",
      url: DEFAULT_URL.backend,
      estado: "idle",
      haConectado: false,
      socket: null,
      sid: "—",
      pendientes: [],
    },
    {
      clave: "mcp",
      etiqueta: "MCP bridge",
      url: DEFAULT_URL.mcp,
      estado: "idle",
      haConectado: false,
      socket: null,
      sid: "—",
      pendientes: [],
    },
  ];

  var storageDisponible = true;

  var $statusDot = document.getElementById("status-dot");
  var $statusText = document.getElementById("status-text");
  var $toolCount = document.getElementById("tool-count");
  var $log = document.getElementById("log");
  var $connectUrl = document.getElementById("connect-url");
  var $clearLog = document.getElementById("clear-log");

  // Contador GLOBAL: es la suma de los dos puentes. Un `tool_call` puede venir
  // del backend o del MCP indistintamente y la cifra interesa del conjunto.
  var toolsHandled = 0;

  // Cada puente se enlaza con sus propios nodos; se resuelven en un bucle para
  // no dejar ids escritos a mano en dos sitios.
  for (var i = 0; i < puentes.length; i++) {
    puentes[i].$input = document.getElementById("endpoint-" + puentes[i].clave);
    puentes[i].$copy = document.getElementById("copy-" + puentes[i].clave);
    puentes[i].$sid = document.getElementById("sid-" + puentes[i].clave);
  }

  function flashButton(btn, label, cls) {
    if (!btn) return;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    btn.textContent = label;
    btn.classList.add(cls);
    if (btn._resetTimer) clearTimeout(btn._resetTimer);
    btn._resetTimer = setTimeout(function () {
      btn.textContent = btn.dataset.label;
      btn.classList.remove("btn-ok", "btn-err");
      btn._resetTimer = null;
    }, 1600);
  }

  function fallbackCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (_) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  // ---------------------------------------------------------------------
  // Estado agregado: el pill resume los dos puentes, no uno.
  //
  // El texto dice cuantos hay vivos (conectado (1/2)) y el punto de color dice
  // si el conjunto esta estable: verde solo cuando los dos lo estan. Con uno
  // solo, el otro sigue reintentando en segundo plano, asi que el punto se
  // queda en "conectando" (pulsando) aunque haya servicio.
  // ---------------------------------------------------------------------
  function actualizarEstado() {
    var conectados = 0;
    var conectando = 0;
    var reconectando = false;
    var total = puentes.length;

    for (var i = 0; i < total; i++) {
      var p = puentes[i];
      if (p.estado === "connected") conectados++;
      if (p.estado === "connecting") {
        conectando++;
        if (p.haConectado) reconectando = true;
      }
      if (p.$sid) p.$sid.textContent = p.estado === "connected" ? p.sid : "—";
    }

    var clase = "connecting";
    var texto;
    if (conectados === total) {
      clase = "connected";
      texto = "conectado (" + conectados + "/" + total + ")";
    } else if (conectados > 0) {
      texto = "conectado (" + conectados + "/" + total + ")";
    } else if (conectando > 0) {
      texto = reconectando ? "reconectando" : "conectando";
    } else {
      clase = "offline";
      texto = "desconectado";
    }

    if ($statusDot) $statusDot.className = "dot " + clase;
    if ($statusText) $statusText.textContent = texto;
  }

  // ---------------------------------------------------------------------
  // Log con etiqueta de puente: `[etiqueta · url] mensaje`.
  //
  // La etiqueta se rellena con espacios hasta el ancho de la mas larga para que
  // las columnas cuadren (el contenedor va en `white-space: pre`). Asi de un
  // vistazo se ve que linea es de quien, y no hay que leerla entera.
  // ---------------------------------------------------------------------
  function etiquetaLarga(puente) {
    if (!puente) return "[interfaz · local]";
    return "[" + puente.etiqueta + " · " + puente.url + "]";
  }

  function anchoEtiqueta() {
    var ancho = 0;
    for (var i = 0; i < puentes.length; i++) {
      var largo = etiquetaLarga(puentes[i]).length;
      if (largo > ancho) ancho = largo;
    }
    return ancho;
  }

  function logLine(texto, cls, puente) {
    if (!$log) return;
    var line = document.createElement("div");
    line.className = "line" + (cls ? " " + cls : "");
    var ts = new Date().toTimeString().slice(0, 8);
    var etiqueta = etiquetaLarga(puente);
    while (etiqueta.length < anchoEtiqueta()) etiqueta += " ";
    line.innerHTML =
      '<span class="ts">' +
      ts +
      "</span>  " +
      '<span class="pt ' +
      (puente ? puente.clave : "ui") +
      '">' +
      escapeHtml(etiqueta) +
      "</span>  " +
      escapeHtml(texto);
    $log.appendChild(line);
    while ($log.childNodes.length > 300) $log.removeChild($log.firstChild);
    $log.scrollTop = $log.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function incrementToolCount() {
    toolsHandled++;
    if ($toolCount) $toolCount.textContent = String(toolsHandled);
  }

  // ---------------------------------------------------------------------
  // Persistencia de las URLs (una clave por puente).
  // ---------------------------------------------------------------------
  /** Lo que hay escrito en el input del puente, trimmeado; si vacio, su default. */
  function urlDelInput(puente) {
    var escrito =
      puente.$input && puente.$input.value
        ? String(puente.$input.value).trim()
        : "";
    return escrito || DEFAULT_URL[puente.clave];
  }

  /** localStorage inaccesible (origen `this-sm:` opaco): se avisa UNA sola vez. */
  function avisarSinStorage() {
    if (!storageDisponible) return;
    storageDisponible = false;
    logLine(
      "aviso: localStorage no disponible, las URLs de los puentes no se persistirán",
      "err",
    );
  }

  /** Guarda la URL del puente. Si localStorage no responde, se avisa una vez. */
  function persistirUrl(puente, url) {
    puente.url = url;
    try {
      window.localStorage.setItem(STORAGE_KEY[puente.clave], url);
      storageDisponible = true;
    } catch (_) {
      avisarSinStorage();
    }
  }

  /** Lee la URL guardada del puente; si no hay o falla, su default. */
  function leerUrlGuardada(puente) {
    try {
      var guardada = window.localStorage.getItem(STORAGE_KEY[puente.clave]);
      if (guardada) {
        var limpia = String(guardada).trim();
        if (limpia) return limpia;
      }
      // Migracion desde la version de un solo puente: aquel default era 7532
      // (el MCP), asi que su valor se queda como configuracion del MCP. Solo si
      // el puente no tiene clave propia todavia, para no pisar una edicion
      // posterior con un valor viejo.
      if (puente.clave === "mcp") {
        var legado = window.localStorage.getItem(STORAGE_KEY_LEGADO);
        if (legado) {
          var limpio = String(legado).trim();
          if (limpio) return limpio;
        }
      }
      return DEFAULT_URL[puente.clave];
    } catch (_) {
      avisarSinStorage();
      return DEFAULT_URL[puente.clave];
    }
  }

  function copyUrl(puente) {
    var text = urlDelInput(puente);
    var done = function () {
      flashButton(puente.$copy, "Copiado ✓", "btn-ok");
    };
    var fail = function () {
      var ok = fallbackCopy(text);
      flashButton(puente.$copy, ok ? "Copiado ✓" : "Error", ok ? "btn-ok" : "btn-err");
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fail();
    }
  }

  function clearActivityLog() {
    if (!$log) return;
    $log.textContent = "";
    $log.scrollTop = 0;
    flashButton($clearLog, "Limpiado ✓", "btn-ok");
  }

  // ---------------------------------------------------------------------
  // Resultados que no se pudieron entregar por un corte de conexion.
  //
  // MEDIDO/probado: antes `emitToolResult` hacia `if (!socket.connected) return;`,
  // es decir TIRABA el resultado. El comando ya se habia ejecutado en Packet
  // Tracer, pero el backend seguia esperando hasta su timeout y lo reportaba como
  // FALLO. El agente (un LLM) solo veia ese fallo y reintentaba: el cambio se
  // aplicaba DOS veces. Con `restoreDeviceConfig` o `configureIosDevice` eso deja el
  // equipo con configuracion duplicada o un `configure terminal` a medias, y el
  // usuario no se enteraba.
  //
  // Ahora el resultado se ENCOLA y se entrega en cuanto vuelve su socket. No se
  // llama a `socket.emit` mientras esta desconectado a proposito: socket.io
  // tampona sus propios envios y los reenviaria AL RECONECTAR, y se entregaria dos
  // veces el mismo `tool_call_id`.
  //
  // La cola es POR PUENTE, no global: un resultado pertenece al servidor que
  // pidio el `tool_call`. Con una cola unica, un corte en el backend dejaria sus
  // resultados en la lista y al volver el MCP se los llevaria TODOS (y al reves),
  // que es peor que perderlos: el MCP recibiria un `tool_result` de un
  // `tool_call_id` que no le pertenece y lo resolveria como fallo.
  //
  // Es seguro que un resultado llegue tarde: cada servidor lo resuelve por
  // `tool_call_id` contra su mapa de pendientes y descarta los que no
  // corresponden a ninguna llamada viva.
  // ---------------------------------------------------------------------
  var RESULTADOS_PENDIENTES_MAX = 64;
  var RESULTADOS_PENDIENTES_MS = 300000;

  /**
   * Encola o entrega el resultado POR EL SOCKET QUE LO PIDIO.
   *
   * `socket` es el socket de origen del `tool_call`: el unico por el que se
   * emite. Nunca se cae al socket del otro puente aunque este este conectado.
   */
  function emitToolResult(puente, socket, tcid, tool, args, result) {
    var envelope = {
      tool_call_id: tcid,
      tool_name: tool,
      tool_input: args,
      result: result,
    };

    if (!socket.connected) {
      puente.pendientes.push({ t: Date.now(), envelope: envelope, socket: socket });
      while (puente.pendientes.length > RESULTADOS_PENDIENTES_MAX) {
        puente.pendientes.shift();
      }
      logLine(
        "resultado en cola (sin conexión): " +
          tool +
          " (" +
          puente.pendientes.length +
          " pendiente(s))",
        "err",
        puente,
      );
      // El resultado tardo mas que el corte: si el puente ya volvio con OTRO
      // socket, este no se entregara nunca solo (su `connect` ya paso), asi que
      // se vacia la cola ahora. Sigue siendo el mismo puente, no el otro.
      if (puente.socket && puente.socket !== socket && puente.socket.connected) {
        vaciarResultadosPendientes(puente, puente.socket);
      }
      return;
    }

    socket.emit("tool_result", envelope);
  }

  /** Entrega lo que quedo en cola de ESE puente; lo caducado se descarta. */
  function vaciarResultadosPendientes(puente, socket) {
    if (puente.pendientes.length === 0) return;

    var ahora = Date.now();
    var vivos = [];
    var entregados = 0;
    var caducados = 0;

    for (var i = 0; i < puente.pendientes.length; i++) {
      var item = puente.pendientes[i];
      if (socket.connected) {
        socket.emit("tool_result", item.envelope);
        entregados++;
      } else if (ahora - item.t <= RESULTADOS_PENDIENTES_MS) {
        vivos.push(item);
      } else {
        caducados++;
      }
    }

    puente.pendientes = vivos;
    if (entregados > 0) {
      logLine(
        entregados + " resultado(s) entregado(s) tras reconectar",
        "ok",
        puente,
      );
    }
    if (caducados > 0) {
      logLine(
        caducados +
          " resultado(s) descartado(s) por antigüedad (el backend ya había agotado su espera)",
        "err",
        puente,
      );
    }
  }

  function buildErrorResult(tool, args, message) {
    return {
      success: false,
      error: message,
      tool: tool,
      args: args,
    };
  }

  // Serializa un valor como literal JS valido para montar el runCode.
  // Los strings van SIEMPRE entre comillas (JSON.stringify escapa " y saltos
  // de linea) y se neutralizan U+2028/U+2029, que en ES5 rompen el literal.
  function escapeLineSeparators(text) {
    return text.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  }

  function serializeJsString(value) {
    if (typeof JSON !== "undefined" && JSON.stringify) {
      return escapeLineSeparators(JSON.stringify(value));
    }
    return (
      '"' +
      String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029") +
      '"'
    );
  }

  function serializePTArgument(value) {
    if (typeof value === "string") {
      return serializeJsString(value);
    }
    if (value === null || value === undefined) return "undefined";
    if (typeof value === "boolean" || typeof value === "number") return String(value);
    if (typeof value === "object") {
      try {
        var text = JSON.stringify(value);
        if (text === undefined) return "undefined";
        return escapeLineSeparators(text);
      } catch (_) {
        // objeto circular u otro fallo de serializacion
        return "undefined";
      }
    }
    return "undefined";
  }

  function unwrapRunCodePayload(wrapped) {
    var payload = wrapped;
    if (typeof wrapped === "string") {
      try {
        payload = JSON.parse(wrapped);
      } catch (_) {
        payload = wrapped;
      }
    }

    if (
      payload &&
      typeof payload === "object" &&
      "result" in payload &&
      "success" in payload &&
      "code" in payload
    ) {
      return payload.result;
    }
    return payload;
  }

  function executePTCode(funcName, args) {
    return new Promise(function (resolve, reject) {
      try {
        var argsStr = (args || []).map(serializePTArgument).join(", ");
        var wrapped = $se(
          "runCode",
          "return " + funcName + "(" + argsStr + ");",
        );
        resolve(unwrapRunCodePayload(wrapped));
      } catch (err) {
        reject(err);
      }
    });
  }

  // Orden posicional de los argumentos de cada herramienta.
  // Debe coincidir 1:1 con las funciones globales de userfunctions.js.
  //
  // Solo viven aqui las herramientas a las que el backend o el MCP llaman de
  // verdad. Una entrada de mas no rompe nada, pero es codigo muerto que invita a
  // usarlo y que luego nadie borra. Ya se quitaron:
  //  - `configureIosDevice`: el agente hace su propio ciclo de consola
  //    (`runCommandAsync` + `pollCommandResult`), no la funcion homonima de
  //    userfunctions.js, asi que ese nombre ya no llega nunca aqui.
  //  - `exportTopologyJSON` / `loadTopologyFromJSON`: sin uso; el workspace va y
  //    viene con `exportWorkspace` / `importWorkspace`, que no las llaman.
  var TOOL_ARGS = {
    addDevice: ["deviceName", "deviceModel", "x", "y"],
    addModule: ["deviceName", "slot", "model"],
    addLink: [
      "device1Name",
      "device1Interface",
      "device2Name",
      "device2Interface",
      "linkType",
    ],
    removeDevice: ["deviceNames"],
    removeLink: ["links"],
    configurePcIp: [
      "deviceName",
      "dhcpEnabled",
      "ipaddress",
      "subnetMask",
      "defaultGateway",
      "dnsServer",
    ],
    getNetwork: [],
    getDeviceInfo: ["deviceName"],
    setSimulationMode: ["toSimMode"],
    getSimulationStatus: [],
    stepSimulation: ["direction", "steps"],
    sendPdu: ["sourceDevice", "destinationDevice"],
    renameDevice: ["deviceName", "newName"],
    moveDevice: ["deviceName", "x", "y"],
    setPower: ["deviceName", "power"],
    getPduResults: ["types"],
    getCommandLog: ["deviceName", "limit"],

    // LECTURAS / DIAGNOSTICO (presets sobre runDeviceCommands)
    getRoutingTable: ["deviceName"],
    getVlanConfiguration: ["switchName"],
    getDeviceMetrics: ["deviceName"],
    validateSecurityConfig: ["deviceName"],
    simulateLinkFailure: ["deviceName", "interfaceName", "durationSeconds"],
    restoreLink: ["deviceName", "interfaceName"],

    // MOTOR DE COMANDOS / CONSOLA
    runDeviceCommands: ["deviceName", "commands", "options"],
    // Motor en DOS FASES sobre el evento `commandEnded` de la linea de consola:
    // `runCommandAsync` envia el lote, registra el evento y devuelve
    // `pendienteId` de inmediato; `pollCommandResult` lo sondea en llamadas
    // posteriores (el evento no puede saltar dentro de una llamada nuestra: el
    // busy-wait bloquea el hilo del Script Engine). Ver el README.
    runCommandAsync: ["deviceName", "commands", "options"],
    pollCommandResult: ["pendienteId", "options"],
    readDeviceConsole: ["deviceName", "lines"],
    applyDeviceConfig: ["deviceName", "configText"],

    // SIMULACION / TOPOLOGIA
    pingDevices: ["sourceName", "targetName", "options"],
    reachabilityMatrix: ["sourceName", "targetNames"],
    validateTopology: [],

    // INVENTARIO DE EQUIPOS
    listDeviceModels: [],
    listDeviceModules: ["deviceName"],
    getDeviceConfigSnapshot: ["deviceName"],

    // WORKSPACE (.pkt)
    clearWorkspace: [],
    exportWorkspace: ["filename", "targetDir"],
    importWorkspace: ["filename", "sourcePath", "base64"],
  };

  function buildPositionalArgs(tool, input) {
    var spec = TOOL_ARGS[tool];
    if (!spec) return null;
    var out = [];
    for (var i = 0; i < spec.length; i++) out.push(input[spec[i]]);
    return out;
  }

  /**
   * Atiende un `tool_call` del puente indicado.
   *
   * `socket` es el socket por el que LLEGO la llamada y por el unico que sale
   * el `tool_result`. El cierre lo fija el puente, no el estado global: asi el
   * backend no se lleva nunca la respuesta de una llamada del MCP.
   */
  function handleToolCall(puente, socket, data) {
    data = data || {};
    var tool = data.tool_name;
    var args = data.tool_input || {};
    var tcid = data.tool_call_id;

    if (!tool || !tcid) {
      logLine("tool_call malformado", "err", puente);
      return;
    }

    logLine("→ " + tool + " " + JSON.stringify(args).slice(0, 80), null, puente);

    var positional = buildPositionalArgs(tool, args);
    if (!positional) {
      var unsupported = buildErrorResult(
        tool,
        args,
        "herramienta no compatible: " + tool,
      );
      logLine("← " + tool + " err: herramienta no compatible", "err", puente);
      emitToolResult(puente, socket, tcid, tool, args, unsupported);
      return;
    }

    executePTCode(tool, positional)
      .then(function (result) {
        incrementToolCount();

        var ok = result && result.success !== false;
        logLine(
          "← " + tool + (ok ? " ok" : " err: " + (result && result.error)),
          ok ? "ok" : "err",
          puente,
        );
        emitToolResult(puente, socket, tcid, tool, args, result);
      })
      .catch(function (err) {
        incrementToolCount();

        var msg = (err && err.message) || String(err);
        logLine("← " + tool + " threw: " + msg, "err", puente);
        emitToolResult(
          puente,
          socket,
          tcid,
          tool,
          args,
          buildErrorResult(tool, args, msg),
        );
      });
  }

  function bindSocketEvents(puente, socket) {
    socket.on("connect", function () {
      puente.estado = "connected";
      puente.haConectado = true;
      puente.sid = socket.id;
      logLine("CONECTADO (sid=" + socket.id + ")", "ok", puente);
      // Lo que se ejecuto mientras no habia conexion se entrega ahora; si no se
      // entrega aqui, ese servidor lo dara por fallido aunque el comando ya se
      // hubiera aplicado en Packet Tracer. Solo se vacia la cola de ESTE
      // puente: la del otro ni se mira (tiene su propio socket y su propio
      // `connect`).
      vaciarResultadosPendientes(puente, socket);
      actualizarEstado();
    });

    socket.on("connect_error", function (err) {
      puente.estado = "offline";
      logLine(
        "error de conexión: " + ((err && err.message) || err),
        "err",
        puente,
      );
      actualizarEstado();
    });

    socket.on("disconnect", function (reason) {
      puente.estado = "connecting";
      puente.sid = "—";
      logLine("desconexión: " + reason, "err", puente);
      actualizarEstado();
    });

    socket.on("tool_call", function (data) {
      handleToolCall(puente, socket, data);
    });
  }

  function createSocket(url) {
    return io(url, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // Los dos puentes aceptan este `clientType` explicito ademas de detectar
      // el user-agent de Qt. Es aditivo: solo evita que un cliente sea tomado
      // por otro en el filtrado del handshake.
      query: { clientType: "packet-tracer" },
    });
  }

  // ---------------------------------------------------------------
  // Arranque y reconexion manual.
  // ---------------------------------------------------------------

  /** Cierra el socket del puente sin que su `disconnect` ensucie el log. */
  function cerrarSocket(puente) {
    if (!puente.socket) return;
    // Los listeners se quitan ANTES del `close`; si no, el corte intentional
    // apareceria en el log como una desconexion y como un fallo mas.
    puente.socket.removeAllListeners();
    puente.socket.close();
    puente.socket = null;
    puente.estado = "idle";
    puente.sid = "—";
  }

  /**
   * Conecta (o reconecta) un puente contra la URL indicada y la deja persistida.
   *
   * El corte del socket viejo es sucio a proposito (`cerrarSocket`), asi que la
   * cola del puente NO se vacia aqui: la entrega el handler `connect` del
   * socket nuevo (ver `vaciarResultadosPendientes`). Cada puente va por su
   * cuenta, de modo que reconectar uno no toca el socket del otro.
   */
  function conectar(puente, url, persistir) {
    var destino = String(url || "").trim() || DEFAULT_URL[puente.clave];

    cerrarSocket(puente);

    if (persistir) persistirUrl(puente, destino);
    puente.url = destino;
    if (puente.$input) puente.$input.value = destino;

    puente.estado = "connecting";
    logLine("iniciando conexión a " + destino, null, puente);

    puente.socket = createSocket(destino);
    bindSocketEvents(puente, puente.socket);
    actualizarEstado();
  }

  /** Conecta (o reconecta) los dos puentes con lo que hay escrito. */
  function conectarTodos() {
    for (var i = 0; i < puentes.length; i++) {
      conectar(puentes[i], urlDelInput(puentes[i]), true);
    }
  }

  /** Boton "Conectar" (y Enter en cualquier input): persiste y reconecta ambos. */
  function reconectarAhora() {
    conectarTodos();
    flashButton($connectUrl, "Reconectados ✓", "btn-ok");
  }

  // Arranque: cada input toma su URL guardada (o la migrada, o su default) y se
  // conectan los dos puentes. Se persiste tambien al arrancar para que la
  // configuracion valida en el storage desde el primer momento.
  for (var j = 0; j < puentes.length; j++) {
    puentes[j].url = leerUrlGuardada(puentes[j]);
    if (puentes[j].$input) puentes[j].$input.value = puentes[j].url;
  }

  if ($clearLog) $clearLog.addEventListener("click", clearActivityLog);
  if ($connectUrl) $connectUrl.addEventListener("click", reconectarAhora);
  for (var k = 0; k < puentes.length; k++) {
    (function (p) {
      if (p.$copy) p.$copy.addEventListener("click", function () { copyUrl(p); });
      if (p.$input) {
        p.$input.addEventListener("keydown", function (ev) {
          if (ev && (ev.key === "Enter" || ev.keyCode === 13)) reconectarAhora();
        });
      }
    })(puentes[k]);
  }

  conectarTodos();
})();