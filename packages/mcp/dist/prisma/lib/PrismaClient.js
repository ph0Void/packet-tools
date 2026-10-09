"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prismaClient = void 0;
exports.disconnectPrisma = disconnectPrisma;
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const adapter_better_sqlite3_1 = require("@prisma/adapter-better-sqlite3");
const client_1 = require("../generated/client.js");
const EnvConfig_1 = require("../../config/EnvConfig.js");
const Migrator_1 = require("../Migrator.js");
const NOMBRE_BASE_POR_DEFECTO = ".packet_tools_mcp.db";
function cargarEnvRaizSiFalta() {
    if (process.env.DATABASE_URL_MCP)
        return;
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
        if (process.env.DATABASE_URL_MCP)
            return;
    }
}
cargarEnvRaizSiFalta();
function resolverUrlDeBaseDeDatos() {
    node_fs_1.default.mkdirSync(EnvConfig_1.DATA_DIR, { recursive: true });
    const cruda = (process.env.DATABASE_URL_MCP ?? "").trim();
    if (!cruda)
        return `file:${node_path_1.default.join(EnvConfig_1.DATA_DIR, NOMBRE_BASE_POR_DEFECTO)}`;
    if (!cruda.startsWith("file:"))
        return cruda;
    const ruta = cruda.slice("file:".length);
    if (node_path_1.default.isAbsolute(ruta))
        return cruda;
    return `file:${node_path_1.default.join(EnvConfig_1.DATA_DIR, ruta)}`;
}
(0, Migrator_1.applyMigrations)();
const adapter = new adapter_better_sqlite3_1.PrismaBetterSqlite3({ url: resolverUrlDeBaseDeDatos() });
exports.prismaClient = new client_1.PrismaClient({
    adapter,
    log: process.env.MCP_PRISMA_LOG === "true" ? ["warn", "error"] : ["error"],
});
async function disconnectPrisma() {
    await exports.prismaClient.$disconnect();
}
//# sourceMappingURL=PrismaClient.js.map