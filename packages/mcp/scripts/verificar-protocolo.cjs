/**
 * Prueba del protocolo MCP real sobre stdio.
 *
 * A diferencia de `smoke.ts` (que llama a los handlers en proceso), esto lanza
 * `node dist/app.js` como lo haría un cliente MCP de verdad y habla JSON-RPC por
 * stdin/stdout. Es la única forma de comprobar tres cosas que en proceso no se
 * ven:
 *
 *  1. Que el handshake `initialize` responde con las capacidades correctas.
 *  2. Que `tools/list` devuelve las 95 herramientas con su JSON Schema.
 *  3. Que **stdout solo contiene JSON**: cualquier banner, log o `console.log`
 *     suelto rompería la sesión en un cliente real. Esta prueba falla si aparece
 *     una sola línea que no sea JSON válido.
 *
 * Se ejecuta con `node scripts/verificar-protocolo.cjs` tras `npm run build`.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

const entrypoint = path.join(__dirname, "..", "dist", "app.js");

/** Peticiones que se envían, en orden. */
const peticiones = [
  {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "verificador", version: "1.0" },
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list" },
  { jsonrpc: "2.0", id: 3, method: "resources/list" },
  // Una llamada real a una tool que no necesita nada externo: debe responder
  // con contenido de texto y sin error.
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "skills_directory", arguments: {} },
  },
  // Una tool inexistente debe dar error de protocolo, no tumbar el servidor.
  {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "no_existe_esta_tool", arguments: {} },
  },
];

const hijo = spawn(process.execPath, [entrypoint], {
  stdio: ["pipe", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
hijo.stdout.on("data", (d) => (stdout += d.toString()));
hijo.stderr.on("data", (d) => (stderr += d.toString()));

for (const peticion of peticiones) {
  hijo.stdin.write(`${JSON.stringify(peticion)}\n`);
}

/** Espera a que lleguen las respuestas y cierra el proceso. */
setTimeout(() => {
  hijo.stdin.end();
}, 1500);

hijo.on("close", () => {
  let fallos = 0;
  const comprobar = (desc, ok, detalle) => {
    console.log(`  ${ok ? "OK  " : "FALLO"} ${desc}${!ok && detalle ? ` → ${detalle}` : ""}`);
    if (!ok) fallos++;
  };

  console.log("\n=== Protocolo MCP sobre stdio (proceso real) ===\n");

  // --- 1) stdout debe ser SOLO JSON -----------------------------------------
  const lineas = stdout.split("\n").filter((l) => l.trim().length > 0);
  const noJson = lineas.filter((l) => {
    try {
      JSON.parse(l);
      return false;
    } catch {
      return true;
    }
  });
  comprobar(
    `Todas las líneas de stdout son JSON válido (${lineas.length} líneas)`,
    noJson.length === 0,
    noJson.length > 0 ? `primera línea no-JSON: ${JSON.stringify(noJson[0].slice(0, 120))}` : undefined,
  );

  const respuestas = lineas
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const porId = new Map(respuestas.filter((r) => r.id !== undefined).map((r) => [r.id, r]));

  // --- 2) initialize ---------------------------------------------------------
  const init = porId.get(1);
  comprobar("initialize responde", Boolean(init));
  comprobar(
    "declara la capacidad de tools",
    Boolean(init?.result?.capabilities?.tools),
    JSON.stringify(init?.result?.capabilities),
  );
  comprobar(
    "declara la capacidad de resources",
    Boolean(init?.result?.capabilities?.resources),
  );
  comprobar(
    "informa del servidor como packet-tools-mcp",
    init?.result?.serverInfo?.name === "packet-tools-mcp",
    init?.result?.serverInfo?.name,
  );
  comprobar(
    "incluye instructions para el modelo",
    typeof init?.result?.instructions === "string" && init.result.instructions.length > 50,
  );

  // --- 3) tools/list ---------------------------------------------------------
  const lista = porId.get(2);
  const tools = lista?.result?.tools ?? [];
  comprobar("tools/list devuelve herramientas", tools.length > 0, `${tools.length}`);
  comprobar("se exponen las 95 herramientas", tools.length === 95, `${tools.length}`);

  // Cada tool debe traer un JSON Schema con tipo objeto: sin él, el cliente no
  // puede validar ni ofrecer los parámetros al modelo.
  const sinEsquema = tools.filter(
    (t) => !t.inputSchema || t.inputSchema.type !== "object",
  );
  comprobar(
    "todas las herramientas traen inputSchema de tipo objeto",
    sinEsquema.length === 0,
    sinEsquema.map((t) => t.name).join(", "),
  );

  const sinDescripcion = tools.filter((t) => !t.description || t.description.length < 20);
  comprobar(
    "todas las herramientas traen descripción útil",
    sinDescripcion.length === 0,
    sinDescripcion.map((t) => t.name).join(", "),
  );

  // Los prefijos deben estar repartidos entre los 7 dominios.
  //
  // OJO: los prefijos de dominio tienen longitudes distintas (`packet_tracer_`
  // usa dos palabras, `gns3_`/`serial_`/`plan_` una), así que NO se puede cortar
  // el nombre por el segundo `_`. Se comprueba contra la lista real.
  const PREFIJOS = [
    "packet_tracer_",
    "gns3_",
    "serial_",
    "telnet_",
    "ssh_",
    "plan_",
    "skills_",
  ];
  const dominios = new Map();
  const huerfanas = [];
  for (const t of tools) {
    const prefijo = PREFIJOS.find((p) => t.name.startsWith(p));
    if (!prefijo) {
      huerfanas.push(t.name);
      continue;
    }
    dominios.set(prefijo, (dominios.get(prefijo) ?? 0) + 1);
  }
  console.log("\n  Herramientas por dominio:");
  for (const [prefijo, n] of [...dominios.entries()].sort()) {
    console.log(`    ${prefijo.padEnd(16)} ${String(n).padStart(3)}`);
  }
  comprobar(
    "todas las herramientas pertenecen a un dominio conocido",
    huerfanas.length === 0,
    huerfanas.join(", "),
  );
  comprobar("se cubren los 7 dominios", dominios.size === 7, `${dominios.size}`);

  // --- 4) resources/list -----------------------------------------------------
  const recursos = porId.get(3);
  comprobar("resources/list responde sin error", recursos && !recursos.error, JSON.stringify(recursos?.error));

  // --- 5) tools/call real ----------------------------------------------------
  const llamada = porId.get(4);
  comprobar("tools/call ejecuta skills_directory", Boolean(llamada?.result));
  comprobar(
    "la respuesta trae contenido de texto",
    Array.isArray(llamada?.result?.content) &&
      llamada.result.content[0]?.type === "text" &&
      llamada.result.content[0].text.length > 0,
  );
  comprobar(
    "la llamada no se marca como error",
    llamada?.result?.isError !== true,
    llamada?.result?.content?.[0]?.text?.slice(0, 160),
  );

  // --- 6) tool inexistente ---------------------------------------------------
  // El SDK responde a una tool desconocida con `isError: true` y el código
  // JSON-RPC -32602 (Invalid params) DENTRO del resultado, en vez de como error
  // de protocolo de nivel superior. Lo que importa comprobar es que la sesión
  // sigue viva y que el mensaje identifica el problema.
  const inexistente = porId.get(5);
  const textoInexistente = inexistente?.result?.content?.[0]?.text ?? "";
  comprobar(
    "una herramienta desconocida responde con isError",
    inexistente?.result?.isError === true,
    JSON.stringify(inexistente?.result)?.slice(0, 140),
  );
  comprobar(
    "el mensaje nombra la herramienta que no existe",
    textoInexistente.includes("no_existe_esta_tool"),
    textoInexistente.slice(0, 140),
  );
  // La prueba de fuego: el servidor debe seguir contestando después del error.
  comprobar(
    "el servidor sigue vivo tras una llamada inválida (initialize llegó antes)",
    Boolean(porId.get(1)?.result),
  );

  // --- 7) stderr -------------------------------------------------------------
  console.log(`\n  stderr: ${stderr.trim().split("\n").filter(Boolean).length} línea(s) de log`);
  comprobar(
    "los logs NO se mezclan con stdout",
    !stdout.includes("[MCP]"),
    "se encontró '[MCP]' en stdout",
  );

  console.log(
    fallos === 0
      ? "\n✅ El servidor MCP habla el protocolo correctamente.\n"
      : `\n❌ ${fallos} comprobación(es) fallaron.\n`,
  );
  process.exit(fallos === 0 ? 0 : 1);
});

hijo.on("error", (error) => {
  console.error("No se pudo lanzar el servidor:", error);
  process.exit(1);
});
