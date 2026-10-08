import fs from "node:fs";

const TOOL_DESCRIPTIONS = {
  "ciscoPacketTracer/Tool.ts": {
    configureIosDevice:
      "Run Cisco IOS CLI commands on a router or switch (global config mode) and save them with 'write memory'. Use it to configure a device that already exists in the topology.",
    getDeviceInfo:
      "Read full details of one device: model, interfaces, ports and attached links. Use it before configuring or wiring that device.",
    setSimulationMode:
      "Switch Packet Tracer between simulation mode (true) and real-time mode (false). Required before sending PDUs.",
    getSimulationStatus:
      "Report the simulation state: active mode, elapsed time and PDU frame counters.",
    stepSimulation:
      "Step the simulation forward, backward or reset it. Requires simulation mode active.",
    sendPdu:
      "Create and send a native ICMP ping (Simple PDU) between two devices; simulation mode is enabled automatically.",
    renameDevice:
      "Rename a device in the topology; the new name must be unique.",
    moveDevice:
      "Move a device to new x/y coordinates on the logical canvas to avoid overlaps.",
    setPower: "Turn a device on or off.",
    getPduResults:
      "Read simulated traffic results (source, destination, packet status). Use it after stepSimulation to verify connectivity.",
  },
  "gns3/Tool.ts": {
    startGns3LinkCapture:
      "Start a Wireshark capture on a link of the active project. Pick the link with 'linkId' or with 'nodeA'/'nodeB' (id or name). Requires human approval.",
    stopGns3LinkCapture:
      "Stop the running capture of a link (pick it with 'linkId' or 'nodeA'/'nodeB') so its PCAP can be downloaded.",
    getGns3LinkCapture:
      "Report whether a link of the active project is capturing traffic and which capture filters are applied.",
    downloadGns3LinkPcap:
      "Download the PCAP file of a link capture (stop the capture first); returns fileName, sizeBytes and a downloadUrl to open in Wireshark.",
    exportGns3Project:
      "Export the whole project (topology, configuration and artifacts) to a .gns3project file; returns fileName, sizeBytes and downloadUrl. GNS3 requires the project closed: on 'PROJECT_OPEN' close it, export and reopen.",
    autoLayoutGns3Project:
      "Re-layout every node of the active project into BFS columns by connection level; unconnected nodes are placed last. Prevents overlapping node positions.",
  },
  "knowledge/Tool.ts": {
    search_web_tool:
      "Search the public web (DuckDuckGo lite) for up-to-date information; cite the returned URLs in the answer.",
    search_knowledge_base:
      "Search the company vector knowledge base for internal documentation and return the most relevant chunks.",
    ingest_document_to_chroma:
      "Index one document into the vector store so it becomes searchable by the RAG search tool.",
  },
  "serialPort/Tool.ts": {
    sendSerialCommand:
      "Send one CLI command over the device serial port (RS-232/USB) using its providerId; check the output before sending the next command.",
  },
  "ssh/Tool.ts": {
    executeSshCommands:
      "Run an ordered list of CLI commands on a remote device over SSH using its registered providerId.",
  },
  "telnet/Tool.ts": {
    executeTelnetCommands:
      "Run an ordered list of CLI commands on a remote legacy device over Telnet using its registered providerId.",
  },
  "tools/DeviceTools.ts": {
    listDeviceProviders:
      "List registered provider devices (id, name, type, protocol, host, port, serial port, status). Call it first to get a real providerId instead of inventing one.",
    findDeviceByName:
      "Find registered provider devices by name substring; returns the same fields as listDeviceProviders.",
  },
  "tools/OpenConsoleTools.ts": {
    open_terminal_console:
      "Ask the user to open a persistent SSH/Telnet/serial console in the dashboard and wait for confirmation. After it opens, operate with send_command/read_terminal/wait_for_prompt instead of opening parallel connections.",
    openGns3Console:
      "Ask the user to open the Telnet console of a STARTED GNS3 node in the chat dashboard (only 'telnet' console type is supported) and wait for confirmation. Identify the node with 'nodeName' (e.g. R1) or 'nodeId'.",
  },
  "tools/TerminalTools.ts": {
    get_terminal_status:
      "Report whether the user has an active console and return its protocol, device, current prompt and liveness.",
    send_command:
      "Send one CLI command to the user's active console and return the captured output. It always operates on the open console (never opens new connections) and must never close the session (exit, quit, logout, disconnect, close).",
  },
};

const PARAM_REPLACEMENTS = [
  [
    "ID del proyecto GNS3; si se omite se usa el proyecto activo del chat",
    "GNS3 project id; defaults to the chat active project",
  ],
  ["ID único del enlace (alternativa a nodeA/nodeB)", "Link id (alternative to nodeA/nodeB)"],
  ["Separación horizontal entre columnas en píxeles (por defecto 220)", "Horizontal spacing between columns in pixels (default 220)"],
  ["Separación vertical entre nodos en píxeles (por defecto 140)", "Vertical spacing between nodes in pixels (default 140)"],
  ["Margen inicial desde el borde en píxeles (por defecto 60)", "Initial margin from the canvas border in pixels (default 60)"],
  ["Comandos ejecutados consecutivamente separados por saltos de línea (\\n)", "Commands to run in order, one per line"],
  ["Nombre del dispositivo a consultar", "Device name to inspect"],
  ["true = modo simulación, false = modo tiempo real", "true = simulation mode, false = real-time mode"],
  ["Nombre del dispositivo origen", "Source device name"],
  ["Nombre del dispositivo destino", "Destination device name"],
  ["Nombre actual del dispositivo", "Current device name"],
  ["Nuevo nombre único", "New unique name"],
  ["Nombre del dispositivo a reposicionar", "Device name to move"],
  ["Filtrar por dispositivo específico. Omitir para ver todos.", "Filter by a specific device; omit to list all"],
  ["Límite máximo de registros a retornar, del más nuevo al más viejo", "Max records to return, newest first"],
  ["Consulta de búsqueda o palabras clave", "Search query or keywords"],
  ["Consulta de búsqueda", "Search query"],
  ["Título del documento", "Document title"],
  ["ID único del documento (ej: ID del KnowledgeBase)", "Unique document id (e.g. the KnowledgeBase id)"],
  ["ID del dispositivo proveedor Serial en DB", "Registered provider id of the serial device"],
  ["ID del dispositivo proveedor SSH registrado en la base de datos", "Registered provider id of the SSH device"],
  ["ID del dispositivo proveedor Telnet registrado en la base de datos", "Registered provider id of the Telnet device"],
  ["Nombre del dispositivo a buscar", "Device name to look up"],
  ["ID del dispositivo proveedor registrado (obtenido con listDeviceProviders)", "Registered provider id (from listDeviceProviders)"],
  ["Host/IP del dispositivo (SSH/Telnet) cuando no hay providerId", "Device host/IP (SSH/Telnet) when there is no providerId"],
  ["Usuario de conexión SSH/Telnet cuando no hay providerId", "SSH/Telnet username when there is no providerId"],
  ["Nombre legible para la tarjeta de confirmación", "Human-readable name shown on the confirmation card"],
  ["ID único del nodo (alternativa a nodeName)", "Node id (alternative to nodeName)"],
  ["Nombre del nodo (ej: R1); coincidencia exacta sin distinguir mayúsculas y luego parcial", "Node name (e.g. R1); case-insensitive exact match, then partial"],
  ["Cantidad de líneas recientes a devolver (1-${MAX_LINES}, por defecto ${DEFAULT_LINES})", "Number of recent lines to return (1-${MAX_LINES}, default ${DEFAULT_LINES})"],
  ["Tiempo máximo de espera en milisegundos (por defecto 10000, máximo 60000)", "Max wait in milliseconds (default 10000, max 60000)"],
  ["Tiempo máximo de espera de salida en milisegundos", "Max wait for output in milliseconds"],
  ["Nombre del dispositivo", "Device name"],
];

const ROOT = "src/agent";
const SPANISH_PATTERN =
  /[áéíóúÁÉÍÓÚñÑ¿¡]|\b(Úsala|Devuelve|Envía|Busca|Elimina|Instancia|Ejecuta|Modifica|Restaura|Enciende|Reposiciona|sin distinguir mayúsculas|del proyecto|del dispositivo|la tool|las tools|de la base de datos)\b/;

function listFiles() {
  const output = [];
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) {
      output.push(entry.name);
      continue;
    }
    if (!entry.isDirectory()) continue;
    for (const name of fs.readdirSync(`${ROOT}/${entry.name}`)) {
      if (name.endsWith(".ts")) output.push(`${entry.name}/${name}`);
    }
  }
  return output;
}

let toolChanges = 0;
let paramChanges = 0;
const unmatched = [];

for (const [relativePath, tools] of Object.entries(TOOL_DESCRIPTIONS)) {
  const filePath = `${ROOT}/${relativePath}`;
  let source = fs.readFileSync(filePath, "utf8");
  for (const [toolName, text] of Object.entries(tools)) {
    const re = new RegExp(
      `(name:\\s*"${toolName}",\\s*\\r?\\n\\s*description:\\s*)(?:"(?:[^"\\\\]|\\\\.)*"(?:\\s*\\+\\s*"(?:[^"\\\\]|\\\\.)*")*)`,
    );
    if (!re.test(source)) {
      unmatched.push(`${relativePath}::${toolName}`);
      continue;
    }
    source = source.replace(re, `$1${JSON.stringify(text)}`);
    toolChanges += 1;
  }
  fs.writeFileSync(filePath, source, "utf8");
}

for (const [oldText, newText] of PARAM_REPLACEMENTS) {
  for (const relativePath of listFiles()) {
    const filePath = `${ROOT}/${relativePath}`;
    const source = fs.readFileSync(filePath, "utf8");
    if (!source.includes(oldText)) continue;
    const count = source.split(oldText).length - 1;
    fs.writeFileSync(filePath, source.split(oldText).join(newText), "utf8");
    paramChanges += count;
    console.log(`[param] ${relativePath}: ${count}x ${oldText.slice(0, 45)}`);
  }
}

console.log(`\nDescripciones de herramienta actualizadas: ${toolChanges}`);
console.log(`Textos de parámetros actualizados: ${paramChanges}`);
if (unmatched.length) console.log(`SIN COINCIDENCIA: ${unmatched.join(", ")}`);



