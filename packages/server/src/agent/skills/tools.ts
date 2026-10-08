import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { requestContext } from "@/utils/RequestContext";
import { invalidateSkillsCache, slugify } from "./loader";

interface SkillTurn {
  userId: string;
  username: string;
  role: string;
  emit?: (event: string, data: unknown) => void;
}

function turno(): SkillTurn | null {
  return (requestContext.getStore() as SkillTurn | undefined) ?? null;
}

class SkillError extends Error {}

function exigeAdmin(operacion: string): SkillTurn {
  const ctx = turno();
  if (!ctx) throw new SkillError(`No hay contexto de turno para ${operacion}.`);
  if (ctx.role !== "ADMIN") {
    throw new SkillError(
      `Operación '${operacion}' reservada al rol ADMIN (rol actual: ${ctx.role}).`,
    );
  }
  return ctx;
}

function exigeStaff(operacion: string): SkillTurn {
  const ctx = turno();
  if (!ctx) throw new SkillError(`No hay contexto de turno para ${operacion}.`);
  if (ctx.role !== "ADMIN" && ctx.role !== "STAFF") {
    throw new SkillError(
      `Operación '${operacion}' requiere rol ADMIN o STAFF (rol actual: ${ctx.role}).`,
    );
  }
  return ctx;
}

async function auditarSkill(params: {
  accion: string;
  objetivo: string;
  resultado: "ok" | "error";
  payload?: Record<string, unknown>;
}): Promise<void> {
  const ctx = turno();
  try {
    await prismaClient.log.create({
      data: {
        level: "ADMIN_ACTION",
        title: `${params.accion} skill → ${params.objetivo}`,

        userId: ctx?.userId ?? null,
        content:
          `actor=${ctx?.username ?? "system"} (${ctx?.role ?? "?"}) ` +
          `resultado=${params.resultado}` +

          (params.payload === undefined ? "" : ` payload=${JSON.stringify(params.payload)}`),
      },
    });
  } catch {

  }
  ctx?.emit?.("admin_action", {
    action: params.accion,
    target: `skill:${params.objetivo}`,
    result: params.resultado,
  });
}

function responder(fn: () => Promise<unknown>): Promise<string> {
  return (async () => {
    try {
      return JSON.stringify(await fn());
    } catch (error) {
      if (error instanceof SkillError) {
        return JSON.stringify({ success: false, error: error.message });
      }
      throw error;
    }
  })();
}

async function buscarSkillPorTitulo(titulo: string) {
  const candidatas = await prismaClient.knowledgeBase.findMany({
    where: { type: "SKILL" },
    select: { id: true, title: true, description: true },
  });
  const objetivo = titulo.trim().toLowerCase();
  return (
    candidatas.find(
      (skill) => skill.title.trim().toLowerCase() === objetivo,
    ) ?? null
  );
}

const listSkillsTool = tool(
  async ({ filter }) => {
    const skills = await prismaClient.knowledgeBase.findMany({
      where: { type: "SKILL" },
      select: {
        id: true,
        title: true,
        description: true,
        updatedAt: true,
        content: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    const conPreview = skills.map((skill) => ({
      id: skill.id,
      title: skill.title,
      slug: slugify(skill.title),
      description: skill.description,

      preview: skill.content.slice(0, 200),
      updatedAt: skill.updatedAt,
    }));
    const filtradas = filter?.query
      ? conPreview.filter((skill) =>
          `${skill.title} ${skill.description ?? ""}`
            .toLowerCase()
            .includes(filter.query!.toLowerCase()),
        )
      : conPreview;
    return JSON.stringify({ success: true, count: filtradas.length, skills: filtradas });
  },
  {
    name: "listSkills",
    description:
      "Lista las skills de agente disponibles (playbooks reutilizables) con su título, descripción y un extracto. Úsala para responder '¿qué skills tengo?' o antes de crear una similar.",
    schema: z.object({
      filter: z.object({ query: z.string().max(200).optional() }).optional(),
    }),
  },
);

const createSkillTool = tool(
  async (args) =>
    responder(async () => {
      const ctx = exigeStaff("createSkill");
      const slug = slugify(args.title);

      const existente = await buscarSkillPorTitulo(args.title);
      if (existente) {
        return {
          success: true,
          created: false,
          reason: `Ya existe la skill «${existente.title}» (id ${existente.id}). Actualízala si el contenido debe cambiar.`,
          skill: { id: existente.id, title: existente.title, slug },
        };
      }

      const creada = await prismaClient.knowledgeBase.create({
        data: {
          title: args.title,
          description: args.description ?? null,
          content: args.content,
          type: "SKILL",
          createdById: ctx.userId,
        },
        select: { id: true, title: true, description: true, updatedAt: true },
      });

      invalidateSkillsCache();
      await auditarSkill({
        accion: "createSkill",
        objetivo: creada.title,
        resultado: "ok",
        payload: { id: creada.id, slug },
      });
      ctx.emit?.("skill_created", { skillId: creada.id, title: creada.title });

      return { success: true, created: true, skill: creada };
    }),
  {
    name: "createSkill",
    description:
      "Crea una skill de agente (playbook reutilizable) en la base de conocimiento. Antes de crearla, consulta listSkills para no duplicar. El contenido debe incluir cuándo aplicarla y los pasos concretos.",
    schema: z.object({
      title: z.string().min(1).max(200),
      description: z
        .string()
        .max(1024)
        .optional()
        .describe("Cuándo usar esta skill y para qué (una frase)"),
      content: z
        .string()
        .min(1)
        .max(100_000)
        .describe("Cuerpo de la skill: pasos, comandos de ejemplo y criterios de verificación"),
    }),
  },
);

const updateSkillTool = tool(
  async (args) =>
    responder(async () => {
      exigeStaff("updateSkill");
      const actual = await prismaClient.knowledgeBase.findFirst({
        where: { id: args.id, type: "SKILL" },
      });
      if (!actual) throw new SkillError(`No existe la skill '${args.id}'.`);

      const actualizada = await prismaClient.knowledgeBase.update({
        where: { id: args.id },
        data: {
          title: args.title,
          description: args.description,
          content: args.content,
        },
        select: { id: true, title: true, description: true, updatedAt: true },
      });
      invalidateSkillsCache();
      await auditarSkill({
        accion: "updateSkill",
        objetivo: actualizada.title,
        resultado: "ok",
      });
      return { success: true, skill: actualizada };
    }),
  {
    name: "updateSkill",
    description:
      "Actualiza el título, la descripción o el contenido de una skill existente.",
    schema: z.object({
      id: z.string().min(1),
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(1024).optional(),
      content: z.string().min(1).max(100_000).optional(),
    }),
  },
);

const deleteSkillTool = tool(
  async ({ id }) =>
    responder(async () => {

      exigeAdmin("deleteSkill");
      const actual = await prismaClient.knowledgeBase.findFirst({
        where: { id, type: "SKILL" },
        select: { id: true, title: true },
      });
      if (!actual) throw new SkillError(`No existe la skill '${id}'.`);

      await prismaClient.knowledgeBase.delete({ where: { id } });
      invalidateSkillsCache();
      await auditarSkill({
        accion: "deleteSkill",
        objetivo: actual.title,
        resultado: "ok",
      });
      return { success: true, deletedId: id };
    }),
  {
    name: "deleteSkill",
    description:
      "Elimina permanentemente una skill. Es destructivo: requiere rol ADMIN y confirmación del usuario.",
    schema: z.object({ id: z.string().min(1) }),
  },
);

const createKnowledgeDocumentTool = tool(
  async (args) =>
    responder(async () => {
      const ctx = exigeStaff("createKnowledgeDocument");

      const existente = await prismaClient.knowledgeBase.findFirst({
        where: { type: "DATA", title: args.title },
      });
      if (existente) {
        return {
          success: true,
          created: false,
          reason: "Ya existe un documento con ese título.",
          document: { id: existente.id, title: existente.title },
        };
      }
      const creado = await prismaClient.knowledgeBase.create({
        data: {
          title: args.title,
          description: args.description ?? null,
          content: args.content,
          type: "DATA",
          createdById: ctx.userId,
        },
        select: { id: true, title: true, updatedAt: true },
      });
      await auditarSkill({
        accion: "createKnowledgeDocument",
        objetivo: creado.title,
        resultado: "ok",
      });
      return { success: true, created: true, document: creado };
    }),
  {
    name: "createKnowledgeDocument",
    description:
      "Añade un documento (tipo DATA) a la base de conocimiento para que el RAG lo recupere. Para playbooks de agente usa createSkill en su lugar.",
    schema: z.object({
      title: z.string().min(1).max(200),
      description: z.string().max(1024).optional(),
      content: z.string().min(1).max(200_000),
    }),
  },
);

export const SKILL_TOOLS = [
  listSkillsTool,
  createSkillTool,
  updateSkillTool,
  deleteSkillTool,
  createKnowledgeDocumentTool,
] as const;

export const SKILL_TOOLS_STAFF = SKILL_TOOLS.filter(
  (t) => t.name !== "deleteSkill",
);
