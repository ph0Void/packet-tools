
const { spawn } = require("node:child_process");
const path = require("node:path");

const entrypoint = path.join(__dirname, "..", "dist", "app.js");


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
  
  
  {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "skills_directory", arguments: {} },
  },
  
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

  
  const lista = porId.get(2);
  const tools = lista?.result?.tools ?? [];
  comprobar("tools/list devuelve herramientas", tools.length > 0, `${tools.length}`);
  comprobar("se exponen las 95 herramientas", tools.length === 95, `${tools.length}`);

  
  
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

  
  const recursos = porId.get(3);
  comprobar("resources/list responde sin error", recursos && !recursos.error, JSON.stringify(recursos?.error));

  
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
  
  comprobar(
    "el servidor sigue vivo tras una llamada inválida (initialize llegó antes)",
    Boolean(porId.get(1)?.result),
  );

  
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
