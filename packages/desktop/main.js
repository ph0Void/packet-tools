"use strict";
const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const http = require("node:http");
const net = require("node:net");
const { spawn } = require("node:child_process");
const APP_NAME = "Packet Tools";
const DEFAULT_SERVER_PORT = 7531;
const DEFAULT_WEB_PORT = 3090;
app.setName(APP_NAME);
if (app.isPackaged) {
  app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));
}
if (process.platform === "win32") {
  app.setAppUserModelId("com.ph0.packettools");
}
const BOOTSTRAP_TIMEOUT_MS = 120000;
const SERVER_TIMEOUT_MS = 60000;
const WEB_TIMEOUT_MS = 90000;
const children = new Map();
let mainWindow = null;
let isClosing = false;
function log(message) {
  console.log(`[main] ${message}`);
}
function readBuildInfo(appResources) {
  const defaults = {
    name: APP_NAME,
    version: app.getVersion(),
    serverPort: DEFAULT_SERVER_PORT,
    webPort: DEFAULT_WEB_PORT,
    backendUrl: `http://localhost:${DEFAULT_SERVER_PORT}`,
  };
  const filePath = path.join(appResources, "build-info.json");
  try {
    const info = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { ...defaults, ...info };
  } catch (error) {
    console.warn(`[main] No se pudo leer ${filePath}; se usan valores por defecto: ${error.message}`);
    return defaults;
  }
}
function getJwtSecret(userDir) {
  const secretPath = path.join(userDir, ".jwt-secret");
  try {
    const existing = fs.readFileSync(secretPath, "utf8").trim();
    if (existing) return existing;
  } catch {
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  return secret;
}
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const testServer = net.createServer();
    testServer.unref();
    testServer.once("error", () => resolve(false));
    testServer.once("listening", () => testServer.close(() => resolve(true)));
    testServer.listen(port, "127.0.0.1");
  });
}
function readLastLines(logPath, limit = 40) {
  try {
    const lines = fs.readFileSync(logPath, "utf8").trimEnd().split(/\r?\n/);
    return lines.slice(-limit).join("\n");
  } catch {
    return "(no hay log disponible)";
  }
}
function killChildren() {
  if (isClosing) return;
  isClosing = true;
  for (const [name, entry] of children) {
    try {
      if (entry.childProcess.exitCode === null && !entry.childProcess.killed) {
        log(`Deteniendo proceso "${name}"...`);
        entry.childProcess.kill();
      }
    } catch (error) {
      console.error(`[main] No se pudo detener "${name}": ${error.message}`);
    }
  }
  children.clear();
}
function failWithError(title, error, logPath) {
  const details = logPath ? `\n\nÚltimas líneas de ${logPath}:\n${readLastLines(logPath)}` : "";
  const message = `${error.message || error}${details}`;
  console.error(`[main] ${title}: ${message}`);
  try {
    dialog.showErrorBox(title, message);
  } catch {
  }
  killChildren();
  app.exit(1);
}
function resolveNode(appResources) {
  const relativeNodePath = process.platform === "win32" ? "node.exe" : path.join("bin", "node");
  const nodePath = path.join(appResources, "node", relativeNodePath);
  if (!fs.existsSync(nodePath)) {
    throw new Error(`No se encontró el runtime de Node empaquetado en ${nodePath}.`);
  }
  return nodePath;
}
function launchChild(name, binary, script, workDir, envVars, logsDir) {
  const logPath = path.join(logsDir, `${name}.log`);
  fs.appendFileSync(logPath, `\n===== ${new Date().toISOString()} ${name} =====\n`, "utf8");
  const appendLog = (text) => {
    try {
      fs.appendFileSync(logPath, text, "utf8");
    } catch {
    }
  };
  log(`Iniciando "${name}": ${script}`);
  const childProcess = spawn(binary, [script], {
    cwd: workDir,
    env: { ...process.env, ...envVars },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  childProcess.stdout.on("data", (data) => {
    process.stdout.write(`[${name}] ${data.toString()}`);
    appendLog(data);
  });
  childProcess.stderr.on("data", (data) => {
    process.stderr.write(`[${name}] ${data.toString()}`);
    appendLog(data);
  });
  childProcess.on("error", (error) => {
    appendLog(`[error] ${error.stack || error.message}\n`);
  });
  childProcess.on("exit", (code, signal) => {
    appendLog(`[salida] código=${code} señal=${signal}\n`);
  });
  const entry = { childProcess, logPath };
  children.set(name, entry);
  return entry;
}
function waitForExit(entry, name, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`El proceso "${name}" no terminó en ${timeoutMs / 1000} s.`));
    }, timeoutMs);
    entry.childProcess.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`El proceso "${name}" terminó con código ${code}.`));
    });
    entry.childProcess.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
function waitForHttp(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const attempt = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Tiempo de espera agotado esperando ${url}.`));
        return;
      }
      const request = http.get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolve(response.statusCode);
        } else {
          setTimeout(attempt, 500);
        }
      });
      request.setTimeout(3000, () => request.destroy(new Error("timeout")));
      request.on("error", () => {
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });
}
function locateWebServer(appResources) {
  const baseDir = path.join(appResources, "web");
  const candidates = [];
  const pending = [baseDir];
  while (pending.length > 0) {
    const current = pending.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        pending.push(filePath);
      } else if (entry.isFile() && entry.name === "server.js") {
        candidates.push(filePath);
      }
    }
  }
  if (candidates.length === 0) {
    throw new Error(`No se encontró server.js del frontend dentro de ${baseDir}.`);
  }
  const scorePath = (filePath) => {
    let score = 0;
    if (fs.existsSync(path.join(path.dirname(filePath), ".next"))) score += 10;
    if (filePath.endsWith(path.join("packages", "web", "server.js"))) score += 5;
    return score;
  };
  candidates.sort((a, b) => scorePath(b) - scorePath(a));
  return candidates[0];
}
function resolveIcon(appResources) {
  const fileName = process.platform === "win32" ? "ico.ico" : "ico.png";
  const candidates = [
    path.join(appResources, "assets", fileName),
    path.join(__dirname, "assets", fileName),
  ];
  return candidates.find((filePath) => fs.existsSync(filePath)) || candidates[1];
}
function createWindow(url, appResources) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: resolveIcon(appResources),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, description, failedUrl, isMainFrame) => {
      if (!isMainFrame) return;
      if (code === -3) return;
      dialog.showErrorBox(
        "No se pudo cargar la interfaz",
        `Error ${code} (${description}) al cargar ${failedUrl}.`,
      );
    },
  );
  mainWindow.loadURL(url);
}
async function startProduction() {
  const appResources = path.join(process.resourcesPath, "app");
  const userDir = app.getPath("userData");
  const logsDir = path.join(userDir, "logs");
  fs.mkdirSync(userDir, { recursive: true });
  fs.mkdirSync(path.join(userDir, "uploads", "documents"), { recursive: true });
  fs.mkdirSync(logsDir, { recursive: true });
  const buildInfo = readBuildInfo(appResources);
  const serverPort = Number(buildInfo.serverPort) || DEFAULT_SERVER_PORT;
  const webPort = Number(buildInfo.webPort) || DEFAULT_WEB_PORT;
  for (const port of [serverPort, webPort]) {
    if (!(await isPortAvailable(port))) {
      dialog.showErrorBox(
        "Puerto ocupado",
        `El puerto ${port} ya está en uso por otro programa.\n\n` +
          `Cierra ese programa y vuelve a abrir ${APP_NAME}.`,
      );
      app.exit(1);
      return;
    }
  }
  const dbPath = path.join(userDir, "packet_tool_database.db");
  const jwtSecret = getJwtSecret(userDir);
  const nodeBinary = resolveNode(appResources);
  log(`Datos de usuario: ${userDir}`);
  log(`Base de datos: ${dbPath}`);
  const bootstrapScript = path.join(appResources, "server", "dist", "desktop", "Bootstrap.js");
  if (!fs.existsSync(bootstrapScript)) {
    throw new Error(`No se encontró el bootstrap del servidor: ${bootstrapScript}`);
  }
  const bootstrapEntry = launchChild(
    "bootstrap",
    nodeBinary,
    bootstrapScript,
    userDir,
    {
      NODE_ENV: "production",
      DATABASE_URL: `file:${dbPath}`,
      MIGRATIONS_DIR: path.join(appResources, "server", "migrations"),
      NAME: buildInfo.name,
      VERSION: buildInfo.version,
    },
    logsDir,
  );
  try {
    await waitForExit(bootstrapEntry, "bootstrap", BOOTSTRAP_TIMEOUT_MS);
  } catch (error) {
    failWithError("Error al preparar la base de datos", error, bootstrapEntry.logPath);
    return;
  }
  const serverScript = path.join(appResources, "server", "dist", "app.js");
  if (!fs.existsSync(serverScript)) {
    throw new Error(`No se encontró la API del servidor: ${serverScript}`);
  }
  const serverEntry = launchChild(
    "server",
    nodeBinary,
    serverScript,
    userDir,
    {
      NODE_ENV: "production",
      SERVER_PORT: String(serverPort),
      DATABASE_URL: `file:${dbPath}`,
      JWT_SECRET: jwtSecret,
      NAME: buildInfo.name,
      VERSION: buildInfo.version,
    },
    logsDir,
  );
  try {
    await waitForHttp(`http://127.0.0.1:${serverPort}/api/health`, SERVER_TIMEOUT_MS);
    log(`API disponible en http://127.0.0.1:${serverPort}`);
  } catch (error) {
    failWithError("El servidor no respondió", error, serverEntry.logPath);
    return;
  }
  const webScript = locateWebServer(appResources);
  const webEntry = launchChild(
    "web",
    nodeBinary,
    webScript,
    path.dirname(webScript),
    {
      NODE_ENV: "production",
      PORT: String(webPort),
      HOSTNAME: "::",
    },
    logsDir,
  );
  try {
    await waitForHttp(`http://localhost:${webPort}/`, WEB_TIMEOUT_MS);
    log(`Frontend disponible en http://localhost:${webPort}`);
  } catch (error) {
    failWithError("El frontend no respondió", error, webEntry.logPath);
    return;
  }
  createWindow(`http://localhost:${webPort}`, appResources);
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      if (!app.isPackaged) {
        const devUrl = process.env.ELECTRON_START_URL || `http://localhost:${DEFAULT_WEB_PORT}`;
        log(`Modo desarrollo: abriendo ${devUrl}`);
        createWindow(devUrl, path.join(__dirname));
      } else {
        await startProduction();
      }
    } catch (error) {
      failWithError("No se pudo iniciar Packet Tools", error);
    }
  });
  app.on("before-quit", killChildren);
  app.on("will-quit", killChildren);
  process.on("exit", killChildren);
  process.on("uncaughtException", (error) => {
    console.error("[main] Excepción no controlada:", error);
    killChildren();
    try {
      dialog.showErrorBox("Error inesperado", error.stack || error.message);
    } catch {
    }
    app.exit(1);
  });
  app.on("window-all-closed", () => {
    app.quit();
  });
}
