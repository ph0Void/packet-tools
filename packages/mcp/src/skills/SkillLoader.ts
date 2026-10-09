/**
 * Carga de skills del usuario.
 *
 * QUÉ ES UNA SKILL: un archivo markdown con instrucciones libres (convenciones de
 * nombres de dispositivos, políticas de seguridad, procedimientos propios...)
 * que se inyectan como contexto para que el modelo las siga.
 *
 * DE DÓNDE SE LEEN (dos fuentes, a propósito):
 *  1. `packages/mcp/skills/*.md` — en disco, editable por el usuario sin tocar
 *     el MCP. Es la vía principal.
 *  2. La tabla `SkillMcp` de la BD propia del MCP — para las skills que el
 *     propio agente crea o edita con las tools. Se guardan en BD y no en disco
 *     porque el paquete puede ser de solo lectura (npx, Docker).
 *
 * CÓMO LLEGAN AL MODELO: por dos vías complementarias, porque ningún cliente MCP
 * soporta las dos al 100%:
 *  - `resources` de MCP: el contenido de cada skill expuesto como recurso
 *    legible (lo soportan Claude Code, Copilot, etc.).
 *  - Tools `skills_list` / `skills_read`: funciona en CUALQUIER cliente, porque
 *    las tools son la parte del protocolo que todos implementan.
 * Se implementan las dos para no depender de que el cliente soporte `resources`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { envConfig } from "@/config/EnvConfig";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";

/** Una skill cargada, sin importar de dónde venga. */
export interface Skill {
  /** Identificador estable en kebab-case. */
  slug: string;
  title: string;
  description: string | null;
  /** Cuerpo markdown con las instrucciones. */
  content: string;
  /** `file` si vino del disco, `database` si la creó el agente. */
  source: "file" | "database";
  /** Ruta del archivo, cuando viene del disco. */
  filePath?: string;
}

/** Convierte un título en slug: minúsculas, sin acentos, con guiones. */
export function slugify(texto: string): string {
  return (
    texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "skill"
  );
}

/**
 * Extrae el frontmatter YAML sencillo (`---\ntitle: ...\n---`) y el cuerpo.
 *
 * Se implementa a mano en vez de añadir una dependencia de YAML porque el
 * formato que se admite es deliberadamente mínimo: `title`, `description` y
 * `slug`. Cualquier otra cosa se ignora, y el cuerpo es todo lo demás.
 */
function parsearFrontmatter(contenido: string): {
  meta: Record<string, string>;
  cuerpo: string;
} {
  const coincidencia = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(contenido);
  if (!coincidencia) return { meta: {}, cuerpo: contenido };

  const meta: Record<string, string> = {};
  for (const linea of coincidencia[1].split(/\r?\n/)) {
    const par = /^\s*([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(linea);
    if (!par) continue;
    // Se quitan las comillas envolventes si las hay.
    meta[par[1].toLowerCase()] = par[2].trim().replace(/^["']|["']$/g, "");
  }

  return { meta, cuerpo: contenido.slice(coincidencia[0].length) };
}

/** Deriva el título del contenido cuando el archivo no lo declara. */
function tituloDesdeCuerpo(cuerpo: string, slug: string): string {
  const encabezado = /^#\s+(.+)$/m.exec(cuerpo);
  return encabezado ? encabezado[1].trim() : slug;
}

/**
 * Carga las skills del disco.
 *
 * Nunca lanza: si la carpeta no existe o un archivo está corrupto, se salta ese
 * archivo y se sigue. Una skill mal formada no debe impedir que el servidor MCP
 * arranque (dejaría al usuario sin ninguna herramienta por un error de formato).
 */
export async function cargarSkillsDeDisco(): Promise<Skill[]> {
  const carpeta = envConfig.MCP_SKILLS_DIR;
  let archivos: string[];

  try {
    archivos = await fs.readdir(carpeta);
  } catch {
    // La carpeta no existe todavía; se devuelve vacío sin ruido.
    return [];
  }

  const skills: Skill[] = [];

  for (const nombre of archivos) {
    if (!/\.(md|markdown|txt)$/i.test(nombre)) continue;

    const ruta = path.join(carpeta, nombre);
    try {
      const contenido = await fs.readFile(ruta, "utf8");
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
    } catch (error) {
      Logger.warning(`No se pudo leer la skill '${nombre}': ${String(error)}`);
    }
  }

  return skills;
}

/** Carga las skills guardadas en la BD propia del MCP. */
export async function cargarSkillsDeBaseDeDatos(): Promise<Skill[]> {
  try {
    const filas = await prismaClient.skillMcp.findMany({
      where: { enabled: true },
      orderBy: { slug: "asc" },
    });
    return filas.map((fila) => ({
      slug: fila.slug,
      title: fila.title,
      description: fila.description,
      content: fila.content,
      source: "database" as const,
    }));
  } catch (error) {
    // Si la BD no está migrada, el MCP debe seguir funcionando con las de disco.
    Logger.debug(`No se pudieron leer las skills de la BD: ${String(error)}`);
    return [];
  }
}

/**
 * Carga TODAS las skills.
 *
 * Precedencia: las de la BD pisan a las de disco con el mismo slug. El motivo es
 * que las de BD son las que el usuario editó desde el chat (más recientes) y las
 * de disco son el punto de partida.
 */
export async function cargarTodasLasSkills(): Promise<Skill[]> {
  const [deDisco, deBaseDeDatos] = await Promise.all([
    cargarSkillsDeDisco(),
    cargarSkillsDeBaseDeDatos(),
  ]);

  const porSlug = new Map<string, Skill>();
  for (const skill of deDisco) porSlug.set(skill.slug, skill);
  for (const skill of deBaseDeDatos) porSlug.set(skill.slug, skill);

  return [...porSlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Busca una skill por slug exacto (o por título, sin distinguir mayúsculas). */
export async function buscarSkill(referencia: string): Promise<Skill | null> {
  const buscado = referencia.trim().toLowerCase();
  const skills = await cargarTodasLasSkills();

  return (
    skills.find((skill) => skill.slug.toLowerCase() === buscado) ??
    skills.find((skill) => skill.title.toLowerCase() === buscado) ??
    null
  );
}

/** Asegura que la carpeta de skills existe. */
export async function asegurarCarpetaSkills(): Promise<string> {
  await fs.mkdir(envConfig.MCP_SKILLS_DIR, { recursive: true });
  return envConfig.MCP_SKILLS_DIR;
}
