(function () {
  var API_URL = "http://127.0.0.1:7531";

  var $statusDot = document.getElementById("status-dot");
  var $statusText = document.getElementById("status-text");
  var $sid = document.getElementById("sid");
  var $toolCount = document.getElementById("tool-count");
  var $endpoint = document.getElementById("endpoint");
  var $log = document.getElementById("log");
  var $copyUrl = document.getElementById("copy-url");
  var $clearLog = document.getElementById("clear-log");

  var toolsHandled = 0;

  function setStatus(state, label) {
    if ($statusDot) $statusDot.className = "dot " + state;
    if ($statusText) $statusText.textContent = label || state;
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

  function copyClientUrl() {
    var text = (($endpoint && $endpoint.textContent) || API_URL).trim();
    var done = function () {
      flashButton($copyUrl, "Copiado ✓", "btn-ok");
    };
    var fail = function () {
      var ok = fallbackCopy(text);
      flashButton($copyUrl, ok ? "Copiado ✓" : "Error", ok ? "btn-ok" : "btn-err");
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

  function logLine(text, cls) {
    if (!$log) return;
    var line = document.createElement("div");
    line.className = "line" + (cls ? " " + cls : "");
    var ts = new Date().toTimeString().slice(0, 8);
    line.innerHTML = '<span class="ts">' + ts + "</span>  " + escapeHtml(text);
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
  // Ahora el resultado se ENCOLA y se entrega en cuanto el socket vuelve. No se
  // llama a `socket.emit` mientras esta desconectado a proposito: socket.io
  // tampona sus propios envios y los reenviaria AL RECONECTAR, y se entregaria dos
  // veces el mismo `tool_call_id`.
  //
  // Es seguro que un resultado llegue tarde: el backend lo resuelve por
  // `tool_call_id` contra su mapa de pendientes y descarta los que no
  // corresponden a ninguna llamada viva.
  // ---------------------------------------------------------------------
  var RESULTADOS_PENDIENTES_MAX = 64;
  var RESULTADOS_PENDIENTES_MS = 300000;
  var resultadosPendientes = [];

  function emitToolResult(socket, tcid, tool, args, result) {
    var envelope = {
      tool_call_id: tcid,
      tool_name: tool,
      tool_input: args,
      result: result,
    };

    if (!socket.connected) {
      resultadosPendientes.push({ t: Date.now(), envelope: envelope });
      while (resultadosPendientes.length > RESULTADOS_PENDIENTES_MAX) {
        resultadosPendientes.shift();
      }
      logLine(
        "resultado en cola (sin conexión): " + tool + " (" +
          resultadosPendientes.length + " pendiente(s))",
        "err",
      );
      return;
    }

    socket.emit("tool_result", envelope);
  }

  /** Entrega lo que quedo en cola al reconectar; lo caduca se descarta. */
  function vaciarResultadosPendientes(socket) {
    if (resultadosPendientes.length === 0) return;

    var ahora = Date.now();
    var vivos = [];
    var entregados = 0;
    var caducados = 0;

    for (var i = 0; i < resultadosPendientes.length; i++) {
      var item = resultadosPendientes[i];
      if (socket.connected) {
        socket.emit("tool_result", item.envelope);
        entregados++;
      } else if (ahora - item.t <= RESULTADOS_PENDIENTES_MS) {
        vivos.push(item);
      } else {
        caducados++;
      }
    }

    resultadosPendientes = vivos;
    if (entregados > 0) {
      logLine(
        entregados + " resultado(s) entregado(s) tras reconectar",
        "ok",
      );
    }
    if (caducados > 0) {
      logLine(
        caducados + " resultado(s) descartado(s) por antigüedad (el backend ya había agotado su espera)",
        "err",
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
  // Solo viven aqui las herramientas a las que el backend llama de verdad. Una
  // entrada de mas no rompe nada, pero es codigo muerto que invita a usarlo y
  // que luego nadie borra. Ya se quitaron:
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

  function handleToolCall(socket, data) {
    data = data || {};
    var tool = data.tool_name;
    var args = data.tool_input || {};
    var tcid = data.tool_call_id;

    if (!tool || !tcid) {
      logLine("tool_call malformado", "err");
      return;
    }

    logLine("→ " + tool + " " + JSON.stringify(args).slice(0, 80));

    var positional = buildPositionalArgs(tool, args);
    if (!positional) {
      var unsupported = buildErrorResult(
        tool,
        args,
        "herramienta no compatible: " + tool,
      );
      logLine("← " + tool + " err: herramienta no compatible", "err");
      emitToolResult(socket, tcid, tool, args, unsupported);
      return;
    }

    executePTCode(tool, positional)
      .then(function (result) {
        incrementToolCount();

        var ok = result && result.success !== false;
        logLine(
          "← " + tool + (ok ? " ok" : " err: " + (result && result.error)),
          ok ? "ok" : "err",
        );
        emitToolResult(socket, tcid, tool, args, result);
      })
      .catch(function (err) {
        incrementToolCount();

        var msg = (err && err.message) || String(err);
        logLine("← " + tool + " threw: " + msg, "err");
        emitToolResult(
          socket,
          tcid,
          tool,
          args,
          buildErrorResult(tool, args, msg),
        );
      });
  }

  function bindSocketEvents(socket) {
    socket.on("connect", function () {
      setStatus("connected", "conectado");
      if ($sid) $sid.textContent = socket.id;
      logLine("conectado sid=" + socket.id, "ok");
      // Lo que se ejecuto mientras no habia conexion se entrega ahora; si no se
      // entrega aqui, el backend lo dara por fallido aunque el comando ya se
      // hubiera aplicado en Packet Tracer.
      vaciarResultadosPendientes(socket);
    });

    socket.on("connect_error", function (err) {
      setStatus("offline", "desconectado");
      logLine("error de conexión: " + ((err && err.message) || err), "err");
    });

    socket.on("disconnect", function (reason) {
      setStatus("connecting", "reconectando");
      if ($sid) $sid.textContent = "—";
      logLine("desconexión: " + reason, "err");
    });

    socket.on("tool_call", function (data) {
      handleToolCall(socket, data);
    });
  }

  function createSocket() {
    return io(API_URL, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }

  setStatus("connecting", "conectando");
  logLine("conectando a " + API_URL);

  if ($copyUrl) $copyUrl.addEventListener("click", copyClientUrl);
  if ($clearLog) $clearLog.addEventListener("click", clearActivityLog);

  var socket = createSocket();
  bindSocketEvents(socket);
})();
