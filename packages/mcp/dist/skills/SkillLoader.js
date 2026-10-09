"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugify = slugify;
exports.cargarSkillsDeDisco = cargarSkillsDeDisco;
exports.cargarSkillsDeBaseDeDatos = cargarSkillsDeBaseDeDatos;
exports.cargarTodasLasSkills = cargarTodasLasSkills;
exports.buscarSkill = buscarSkill;
exports.asegurarCarpetaSkills = asegurarCarpetaSkills;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const EnvConfig_1 = require("../config/EnvConfig.js");
const PrismaClient_1 = require("../prisma/lib/PrismaClient.js");
const Logger_1 = require("../utils/Logger.js");
function slugify(texto) {
    return (texto
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64) || "skill");
}
function parsearFrontmatter(contenido) {
    const coincidencia = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(contenido);
    if (!coincidencia)
        return { meta: {}, cuerpo: contenido };
    const meta = {};
    for (const linea of coincidencia[1].split(/\r?\n/)) {
        const par = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(linea);
        if (!par)
            continue;
        meta[par[1].toLowerCase()] = par[2].trim().replace(/^["']|["']$/g, "");
    }
    return { meta, cuerpo: contenido.slice(coincidencia[0].length) };
}
function tituloDesdeCuerpo(cuerpo, slug) {
    const encabezado = /^#\s+(.+)$/m.exec(cuerpo);
    return encabezado ? encabezado[1].trim() : slug;
}
async function cargarSkillsDeDisco() {
    const carpeta = EnvConfig_1.envConfig.MCP_SKILLS_DIR;
    let archivos;
    try {
        archivos = await promises_1.default.readdir(carpeta);
    }
    catch {
        return [];
    }
    const skills = [];
    for (const nombre of archivos) {
        if (!/\.(md|markdown|txt)$/i.test(nombre))
            continue;
        const ruta = node_path_1.default.join(carpeta, nombre);
        try {
            const contenido = await promises_1.default.readFile(ruta, "utf8");
            const { meta, cuerpo } = parsearFrontmatter(contenido);
            const slug = meta.slug?.trim() || slugify(nombre.replace(/\.(md|markdown|txt)$/i, ""));
            skills.push({
                slug,
                title: meta.title?.trim() || tituloDesdeCuerpo(cuerpo, slug),
                description: meta.description?.trim() || null,
                content: cuerpo.trim(),
                source: "file",
                filePath: ruta,
            });
        }
        catch (error) {
            Logger_1.Logger.warning(`No se pudo leer la skill '${nombre}': ${String(error)}`);
        }
    }
    return skills;
}
async function cargarSkillsDeBaseDeDatos() {
    try {
        const filas = await PrismaClient_1.prismaClient.skillMcp.findMany({
            where: { enabled: true },
            orderBy: { slug: "asc" },
        });
        return filas.map((fila) => ({
            slug: fila.slug,
            title: fila.title,
            description: fila.description,
            content: fila.content,
            source: "database",
        }));
    }
    catch (error) {
        Logger_1.Logger.debug(`No se pudieron leer las skills de la BD: ${String(error)}`);
        return [];
    }
}
async function cargarTodasLasSkills() {
    const [deDisco, deBaseDeDatos] = await Promise.all([
        cargarSkillsDeDisco(),
        cargarSkillsDeBaseDeDatos(),
    ]);
    const porSlug = new Map();
    for (const skill of deDisco)
        porSlug.set(skill.slug, skill);
    for (const skill of deBaseDeDatos)
        porSlug.set(skill.slug, skill);
    return [...porSlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}
async function buscarSkill(referencia) {
    const buscado = referencia.trim().toLowerCase();
    const skills = await cargarTodasLasSkills();
    return (skills.find((skill) => skill.slug.toLowerCase() === buscado) ??
        skills.find((skill) => skill.title.toLowerCase() === buscado) ??
        null);
}
async function asegurarCarpetaSkills() {
    await promises_1.default.mkdir(EnvConfig_1.envConfig.MCP_SKILLS_DIR, { recursive: true });
    return EnvConfig_1.envConfig.MCP_SKILLS_DIR;
}
//# sourceMappingURL=SkillLoader.js.map