import fs from "node:fs";

const TOOL_DESCRIPTIONS = {
  "ciscoPacketTracer/Tool.ts": {
    getCommandLog: "Read the IOS command history recorded by Packet Tracer.",
  },
  "gns3/Tool.ts": {
    importGns3Project:
      "Import a .gns3project file from the export directory into a new project on this server (topology and configuration included); 'fileName' must be a plain name with the .gns3project extension.",
  },
  "tools/TerminalTools.ts": {
    read_terminal:
      "Read the recent output of the user's active console (SSH, Telnet or serial) to inspect its state before sending the next command.",
    wait_for_prompt:
      "Wait until the active console shows a stable prompt again (e.g. after a long command); 'expected' can require the prompt to contain given text.",
  },
};

const PARAM_REPLACEMENTS = [
  ["Nombre del Router o Switch", "Router or switch device name"],
  [
    "Comandos ejecutados consecutivamente separados por saltos de línea (\\\\n)",
    "Commands to run in order, one per line",
  ],
  ["Cantidad de pasos a tomar (ignorado en 'reset')", "Number of steps to take (ignored on 'reset')"],
  [
    "Filtro opcional por protocolo (ej: ['ICMP', 'ARP']) para limpiar ruido de fondo",
    "Optional protocol filter (e.g. ['ICMP', 'ARP']) to remove background noise",
  ],
  ["Primer extremo del enlace (id o nombre del nodo)", "First link endpoint (node id or name)"],
  ["Segundo extremo del enlace (id o nombre del nodo)", "Second link endpoint (node id or name)"],
  [
    "Nombre del archivo .gns3project en el directorio de exportaciones (ej: 'lab-redes-20260918120000.gns3project')",
    "Name of the .gns3project file in the export directory (e.g. 'lab-redes-20260918120000.gns3project')",
  ],
  [
    "Nombre para el proyecto importado; si se omite, se usa el del archivo",
    "Name for the imported project; defaults to the file name",
  ],
  ["Cantidad de fragmentos a recuperar", "Number of chunks to retrieve"],
  ["Lista de comandos CLI a ejecutar en orden", "CLI commands to run, in order"],
  ["Lista de comandos CLI a enviar por Telnet", "CLI commands to send over Telnet, in order"],
  [
    "Protocolo de la consola a abrir (si no, se usa el del proveedor)",
    "Console protocol to open (defaults to the provider protocol)",
  ],
  ["Puerto TCP (por defecto 22 para SSH y 23 para Telnet)", "TCP port (default 22 for SSH, 23 for Telnet)"],
  ["Puerto serial del equipo (p. ej. COM6 o /dev/ttyUSB0)", "Serial port of the device (e.g. COM6 or /dev/ttyUSB0)"],
  ["Velocidad del puerto serial (por defecto 9600)", "Serial baud rate (default 9600)"],
  [
    "Texto que debe contener el prompt para considerarlo listo (opcional)",
    "Text the prompt must contain to be considered ready (optional)",
  ],
  ["Comando CLI a enviar a la consola activa", "CLI command to send to the active console"],
  ["Alias de waitForPromptMs (compatibilidad)", "Alias of waitForPromptMs (backwards compatibility)"],
];

const ROOT = "src/agent";

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
  let found = false;
  for (const relativePath of listFiles()) {
    const filePath = `${ROOT}/${relativePath}`;
    const source = fs.readFileSync(filePath, "utf8");
    if (!source.includes(oldText)) continue;
    found = true;
    const count = source.split(oldText).length - 1;
    fs.writeFileSync(filePath, source.split(oldText).join(newText), "utf8");
    paramChanges += count;
  }
  if (!found) unmatched.push(`PARAM::${oldText.slice(0, 50)}`);
}

console.log(`Descripciones actualizadas: ${toolChanges} | parámetros: ${paramChanges}`);
if (unmatched.length) console.log(`SIN COINCIDENCIA: ${unmatched.join(" | ")}`);
