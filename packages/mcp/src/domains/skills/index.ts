
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { ModuloDominio, DefinicionToolGenerica } from "@/core/ToolRegistry";
import { definirTool } from "@/core/ToolRegistry";
import {
  asegurarCarpetaSkills,
  buscarSkill,
  cargarTodasLasSkills,
  slugify,
} from "@/skills/SkillLoader";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import { envConfig } from "@/config/EnvConfig";
import { Logger } from "@/utils/Logger";
import { errorDeValidacion, McpToolError } from "@/core/errors";

const herramientas: DefinicionToolGenerica[] = [
  definirTool({
    name: "skills_list",
    description:
      "Lista las skills del usuario (sus instrucciones propias: convenciones de nombres, políticas de seguridad, procedimientos). " +
      "Úsala al empezar una tarea para saber si el usuario ya definió reglas que debas respetar, o cuando el usuario escriba '@skill'.",
    inputSchema: {
      includeContent: z
        .boolean()
        .optional()
        .describe(
          "true para devolver también el contenido completo de cada skill (útil si son pocas y cortas)",
        ),
    },
    handler: async ({ includeContent }) => {
      const skills = await cargarTodasLasSkills();

      if (skills.length === 0) {
        const carpeta = await asegurarCarpetaSkills();
        return {
          success: true,
          total: 0,
          skills: [],
          mensaje:
            `Todavía no hay ninguna skill. El usuario puede crear una poniendo un archivo markdown en '${carpeta}' ` +
            `o pidiéndote que la crees con skills_create.`,
        };
      }

      return {
        success: true,
        total: skills.length,
        carpeta: envConfig.MCP_SKILLS_DIR,
        skills: skills.map((skill) => ({
          slug: skill.slug,
          titulo: skill.title,
          descripcion: skill.description,
          origen: skill.source,
          caracteres: skill.content.length,
          ...(includeContent ? { contenido: skill.content } : {}),
        })),
        mensaje:
          "Usa skills_read con el 'slug' de una skill para leer sus instrucciones completas antes de actuar en su dominio.",
      };
    },
  }),

  definirTool({
    name: "skills_read",
    description:
      "Lee el contenido completo de una skill por su slug. Úsala cuando el usuario escriba '@skill:<slug>' " +
      "o cuando skills_list te muestre una skill relevante para la tarea: sus instrucciones tienen prioridad sobre tus suposiciones.",
    inputSchema: {
      slug: z.string().describe("Identificador de la skill (el campo 'slug' de skills_list)"),
    },
    handler: async ({ slug }) => {
      const skill = await buscarSkill(slug);
      if (!skill) {
        const todas = await cargarTodasLasSkills();
        throw new McpToolError(
          "NO_ENCONTRADO",
          `No existe ninguna skill con el slug '${slug}'.`,
          {
            sugerencia:
              todas.length > 0
                ? `Las skills disponibles son: ${todas.map((s) => s.slug).join(", ")}.`
                : "Todavía no hay skills. Puedes crear una con skills_create.",
          },
        );
      }

      return {
        success: true,
        slug: skill.slug,
        titulo: skill.title,
        descripcion: skill.description,
        origen: skill.source,
        contenido: skill.content,
      };
    },
  }),

  definirTool({
    name: "skills_create",
    description:
      "Crea una skill nueva (o actualiza una existente con el mismo slug) para guardar instrucciones del usuario de forma persistente. " +
      "Úsala cuando el usuario diga cosas como 'guarda esto como norma', 'a partir de ahora usa este convenio de nombres' o pida expresamente crear una skill. " +
      "El contenido es markdown libre: escribe instrucciones claras y accionables, no una descripción vaga.",
    inputSchema: {
      title: z
        .string()
        .describe(
          "Título corto de la skill, por ejemplo 'Convención de nombres de dispositivos'",
        ),
      content: z
        .string()
        .min(1)
        .describe(
          "Instrucciones en markdown. Sé concreto: qué hacer, con qué formato y en qué casos.",
        ),
      description: z
        .string()
        .optional()
        .describe("Resumen de una línea sobre cuándo aplica esta skill"),
      slug: z
        .string()
        .optional()
        .describe("Identificador en kebab-case; si se omite se deriva del título"),
    },
    handler: async ({ title, content, description, slug }) => {
      const slugFinal = slug?.trim() ? slugify(slug) : slugify(title);

      const skill = await prismaClient.skillMcp.upsert({
        where: { slug: slugFinal },
        create: {
          slug: slugFinal,
          title,
          description: description ?? null,
          content,
          source: "agent",
          enabled: true,
        },
        update: {
          title,
          description: description ?? null,
          content,
          enabled: true,
        },
      });

      Logger.info(`Skill '${slugFinal}' guardada.`);

      return {
        success: true,
        slug: skill.slug,
        titulo: skill.title,
        mensaje:
          `Skill '${skill.slug}' guardada y disponible desde ya (no hace falta reiniciar el servidor). ` +
          `El usuario puede invocarla escribiendo '@skill:${skill.slug}'.`,
      };
    },
  }),

  definirTool({
    name: "skills_delete",
    description:
      "Elimina una skill. Si la skill vive en un archivo de disco, se borra el archivo; si la creó el agente, se borra de la base de datos. " +
      "Operación irreversible: confírmala con el usuario salvo que la haya pedido él.",
    inputSchema: {
      slug: z.string().describe("Identificador de la skill a eliminar"),
    },
    handler: async ({ slug }) => {
      const skill = await buscarSkill(slug);
      if (!skill) {
        throw new McpToolError(
          "NO_ENCONTRADO",
          `No existe ninguna skill con el slug '${slug}'.`,
          { sugerencia: "Usa skills_list para ver los slugs disponibles." },
        );
      }

      const borrados: string[] = [];

      if (skill.source === "file" && skill.filePath) {
        
        
        const raiz = path.resolve(envConfig.MCP_SKILLS_DIR);
        const resuelta = path.resolve(skill.filePath);
        if (resuelta.startsWith(raiz + path.sep)) {
          await fs.unlink(resuelta);
          borrados.push("archivo");
        } else {
          throw errorDeValidacion(
            `La skill '${slug}' apunta a un archivo fuera de la carpeta de skills y no se va a borrar.`,
            "Revisa la configuración de MCP_SKILLS_DIR.",
          );
        }
      }

      const resultado = await prismaClient.skillMcp.deleteMany({
        where: { slug: skill.slug },
      });
      if (resultado.count > 0) borrados.push("base de datos");

      return {
        success: true,
        slug: skill.slug,
        borrado: borrados,
        mensaje:
          borrados.length > 0
            ? `Skill '${skill.slug}' eliminada (${borrados.join(" y ")}).`
            : `No se pudo eliminar '${skill.slug}': no se encontró ni el archivo ni la fila.`,
      };
    },
  }),

  definirTool({
    name: "skills_directory",
    description:
      "Devuelve la carpeta donde el usuario puede poner sus archivos de skill en markdown. " +
      "Úsala cuando el usuario pregunte dónde guardar sus instrucciones.",
    inputSchema: {},
    handler: async () => {
      const carpeta = await asegurarCarpetaSkills();
      return {
        success: true,
        carpeta,
        formato: {
          nombreArchivo: "cualquier-nombre.md",
          frontmatterOpcional: [
            "---",
            "title: Convención de nombres",
            "description: Cómo nombrar los dispositivos de la red",
            "slug: convencion-nombres",
            "---",
          ].join("\n"),
          nota:
            "El frontmatter es opcional: sin él, el título se toma del primer encabezado '# ' y el slug del nombre del archivo. " +
            "Los cambios se leen en cada llamada, así que no hace falta reiniciar el servidor MCP.",
        },
        mensaje: `Pon tus archivos .md en '${carpeta}' y aparecerán automáticamente en skills_list.`,
      };
    },
  }),
];

export const moduloSkills: ModuloDominio = {
  id: "skills",
  prefix: "skills_",
  description:
    "Skills del usuario: instrucciones propias en markdown (convenciones, políticas, procedimientos) que el modelo debe respetar.",
  tools: herramientas,
};
