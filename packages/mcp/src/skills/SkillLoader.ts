
import fs from "node:fs/promises";
import path from "node:path";
import { envConfig } from "@/config/EnvConfig";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";


export interface Skill {
  
  slug: string;
  title: string;
  description: string | null;
  
  content: string;
  
  source: "file" | "database";
  
  filePath?: string;
}


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
    
    meta[par[1].toLowerCase()] = par[2].trim().replace(/^["']|["']$/g, "");
  }

  return { meta, cuerpo: contenido.slice(coincidencia[0].length) };
}


function tituloDesdeCuerpo(cuerpo: string, slug: string): string {
  const encabezado = /^#\s+(.+)$/m.exec(cuerpo);
  return encabezado ? encabezado[1].trim() : slug;
}


export async function cargarSkillsDeDisco(): Promise<Skill[]> {
  const carpeta = envConfig.MCP_SKILLS_DIR;
  let archivos: string[];

  try {
    archivos = await fs.readdir(carpeta);
  } catch {
    
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
    
    Logger.debug(`No se pudieron leer las skills de la BD: ${String(error)}`);
    return [];
  }
}


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


export async function buscarSkill(referencia: string): Promise<Skill | null> {
  const buscado = referencia.trim().toLowerCase();
  const skills = await cargarTodasLasSkills();

  return (
    skills.find((skill) => skill.slug.toLowerCase() === buscado) ??
    skills.find((skill) => skill.title.toLowerCase() === buscado) ??
    null
  );
}


export async function asegurarCarpetaSkills(): Promise<string> {
  await fs.mkdir(envConfig.MCP_SKILLS_DIR, { recursive: true });
  return envConfig.MCP_SKILLS_DIR;
}
