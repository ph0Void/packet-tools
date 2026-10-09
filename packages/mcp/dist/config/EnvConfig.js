"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.envConfig = exports.DATA_DIR = exports.PACKAGE_ROOT = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const dotenv_1 = __importDefault(require("dotenv"));
function cargarEnvRaiz() {
    const candidatos = [];
    let actual = __dirname;
    for (let i = 0; i < 8; i++) {
        candidatos.push(node_path_1.default.join(actual, ".env"));
        actual = node_path_1.default.dirname(actual);
    }
    candidatos.push(node_path_1.default.resolve(process.cwd(), ".env"));
    for (const candidato of candidatos) {
        if (!node_fs_1.default.existsSync(candidato))
            continue;
        dotenv_1.default.config({ path: candidato, override: false, quiet: true });
        return;
    }
}
cargarEnvRaiz();
function resolverRaizPaquete() {
    let actual = node_path_1.default.resolve(__dirname, "..", "..");
    for (let i = 0; i < 3; i++) {
        if (node_fs_1.default.existsSync(node_path_1.default.join(actual, "package.json")))
            return actual;
        actual = node_path_1.default.dirname(actual);
    }
    return node_path_1.default.resolve(__dirname, "..", "..");
}
exports.PACKAGE_ROOT = resolverRaizPaquete();
function resolverDirDatos() {
    const explicito = (process.env.MCP_DATA_DIR ?? "").trim();
    if (explicito)
        return node_path_1.default.resolve(explicito);
    const estaEnCache = exports.PACKAGE_ROOT.includes(`${node_path_1.default.sep}node_modules${node_path_1.default.sep}`);
    if (!estaEnCache)
        return exports.PACKAGE_ROOT;
    return node_path_1.default.join(node_os_1.default.homedir(), ".packet-tools", "mcp");
}
exports.DATA_DIR = resolverDirDatos();
function numeroDeEnv(nombre, porDefecto) {
    const bruto = Number(process.env[nombre]);
    return Number.isFinite(bruto) && bruto > 0 ? bruto : porDefecto;
}
function booleanoDeEnv(nombre, porDefecto) {
    const bruto = process.env[nombre];
    if (bruto === undefined || bruto === "")
        return porDefecto;
    return bruto !== "false";
}
function rutaDeEnv(nombre, porDefecto) {
    const bruto = (process.env[nombre] ?? "").trim() || porDefecto;
    return node_path_1.default.isAbsolute(bruto) ? bruto : node_path_1.default.join(exports.DATA_DIR, bruto);
}
exports.envConfig = {
    SERVER_PORT: numeroDeEnv("SERVER_PORT", 7531),
    MCP_BRIDGE_HOST: (process.env.MCP_BRIDGE_HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    MCP_BRIDGE_PORT: numeroDeEnv("MCP_BRIDGE_PORT", 7532),
    MCP_BRIDGE_ENABLED: booleanoDeEnv("MCP_BRIDGE_ENABLED", true),
    MCP_PACKET_TRACER_HOST: (process.env.MCP_PACKET_TRACER_HOST ?? "localhost").trim(),
    PT_EXTENSION_SECRET: (process.env.PT_EXTENSION_SECRET ?? "").trim(),
    MCP_GNS3_URL: (process.env.MCP_GNS3_URL ?? "").trim(),
    MCP_TOOL_TIMEOUT_MS: numeroDeEnv("MCP_TOOL_TIMEOUT_MS", 120_000),
    MCP_TERMINAL_MAX_MS: numeroDeEnv("MCP_TERMINAL_MAX_MS", 20_000),
    MCP_TERMINAL_IDLE_MS: numeroDeEnv("MCP_TERMINAL_IDLE_MS", 700),
    MCP_MAX_OUTPUT_CHARS: numeroDeEnv("MCP_MAX_OUTPUT_CHARS", 20_000),
    MCP_PLANS_DIR: rutaDeEnv("MCP_PLANS_DIR", "plans"),
    MCP_SKILLS_DIR: rutaDeEnv("MCP_SKILLS_DIR", "skills"),
    MCP_DEBUG: booleanoDeEnv("MCP_DEBUG", false),
    MCP_TRACE_TOOLS: booleanoDeEnv("MCP_TRACE_TOOLS", false),
};
//# sourceMappingURL=EnvConfig.js.map