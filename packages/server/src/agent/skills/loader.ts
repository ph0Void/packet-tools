import { prismaClient } from "@/prisma/lib/PrismaClient";
import { Logger } from "@/utils/Logger";

export interface SkillRow {
  id: string;
  title: string;
  description: string | null;
  content: string;
  updatedAt: Date;
}

export interface SkillDocument {
  id: string;

  name: string;
  description: string;

  path: string;
  content: string;
  updatedAt: Date;
}

interface CacheEntry {
  skills: SkillDocument[];
  loadedAt: number;

  version: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

let version = 0;

const MAX_DESCRIPTION_LENGTH = 1024;

const MAX_CONTENT_CHARS = 100_000;

export function slugify(title: string): string {
  const base = String(title ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.slice(0, 64) || "skill";
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function serializeSkillMd(skill: {
  name: string;
  description: string;
  content: string;
}): string {
  const contenido = String(skill.content ?? "").slice(0, MAX_CONTENT_CHARS);
  const yaTieneFrontmatter = /^---\r?\n/.test(contenido.trimStart());
  if (yaTieneFrontmatter) return contenido;

  return [
    "---",
    `name: ${skill.name}`,
    `description: ${yamlString(
      skill.description.slice(0, MAX_DESCRIPTION_LENGTH),
    )}`,
    "---",
    "",
    contenido,
  ].join("\n");
}

function toSkillDocument(row: SkillRow): SkillDocument {
  const name = slugify(row.title);
  const description =
    row.description && row.description.trim().length > 0
      ? row.description.trim()
      : `Skill «${row.title}» de la base de conocimiento de Packet-Tools.`;
  return {
    id: row.id,
    name,
    description: description.slice(0, MAX_DESCRIPTION_LENGTH),
    path: `${SKILLS_ROOT}/${name}/SKILL.md`,
    content: serializeSkillMd({ name, description, content: row.content }),
    updatedAt: row.updatedAt,
  };
}

export const SKILLS_ROOT = "/skills";

export const SKILLS_SECTION_HEADER = "## Available skills (in /skills/)";

export async function loadSkillsFromKnowledgeBase(): Promise<SkillDocument[]> {
  const ahora = Date.now();
  if (cache && ahora - cache.loadedAt < CACHE_TTL_MS) return cache.skills;

  try {
    const rows = await prismaClient.knowledgeBase.findMany({
      where: { type: "SKILL" },
      select: { id: true, title: true, description: true, content: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
    });
    const skills = rows.map(toSkillDocument);
    cache = { skills, loadedAt: ahora, version };
    return skills;
  } catch (error) {

    Logger.error({
      message: "[SKILLS] Error cargando skills desde la base de conocimiento",
      data: error,
    });
    return cache?.skills ?? [];
  }
}

export function invalidateSkillsCache(): void {
  version += 1;
  cache = null;
}

export function getSkillsVersion(): number {
  return version;
}

export async function buildSkillsFilesRecord(): Promise<
  Record<string, {
    content: string;
    mimeType: string;
    created_at: string;
    modified_at: string;
  }>
> {
  const skills = await loadSkillsFromKnowledgeBase();
  const files: Record<
    string,
    {
      content: string;
      mimeType: string;
      created_at: string;
      modified_at: string;
    }
  > = {};
  const ahora = new Date().toISOString();
  for (const skill of skills) {
    files[skill.path] = {
      content: skill.content,
      mimeType: "text/markdown",
      created_at: skill.updatedAt.toISOString(),
      modified_at: skill.updatedAt.toISOString(),
    };
  }
  if (process.env.AGENT_TOKEN_LOGGING === "true") {
    Logger.info({
      message: "[SKILLS] Catálogo proyectado al filesystem virtual",
      data: { total: skills.length, nombres: skills.map((s) => s.name) },
    });
  }
  return files;
}

export async function buildSkillsCatalog(): Promise<string> {
  const skills = await loadSkillsFromKnowledgeBase();
  if (skills.length === 0) return "";
  return [
    SKILLS_SECTION_HEADER,
    "Reusable playbooks stored in the knowledge base. Each one is a directory with a SKILL.md:",
    ...skills.map(
      (skill) => `- ${skill.name} (${skill.path}): ${skill.description}`,
    ),
  ].join("\n");
}

export function clearSkillsCache(): void {
  cache = null;
  version = 0;
}
