/**
 * Exposición de las skills como **resources** de MCP.
 *
 * POR QUÉ `resources` ADEMÁS DE UNA TOOL
 * El protocolo MCP tiene tres capacidades: `tools`, `resources` y `prompts`. Las
 * skills son contenido legible, así que encajan de forma natural en `resources`:
 * un cliente que los soporte (Claude Code, Copilot, etc.) puede listarlos y
 * leerlos sin gastar una llamada a herramienta.
 *
 * PERO no todos los clientes implementan `resources` (LM Studio y algunos
 * clientes ligeros, por ejemplo). Por eso las skills se exponen TAMBIÉN como las
 * tools `skills_list` / `skills_read`: las tools son la única parte del protocolo
 * que todos los clientes soportan sí o sí. Las dos vías leen del mismo sitio, así
 * que nunca se contradicen.
 *
 * URI: `skill://<slug>` (esquema propio, para no chocar con `file://`).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cargarTodasLasSkills } from "./SkillLoader";
import { Logger } from "@/utils/Logger";

/** Prefijo de URI de una skill. */
const ESQUEMA = "skill://";

/** Extrae el slug de una URI `skill://<slug>`. */
function slugDeUri(uri: string): string | null {
  if (!uri.startsWith(ESQUEMA)) return null;
  const slug = uri.slice(ESQUEMA.length).trim();
  return slug.length > 0 ? slug : null;
}

/**
 * Registra las skills como recursos.
 *
 * Se registran de forma DINÁMICA: el `listCallback` lee del disco y de la BD en
 * cada llamada, así que una skill creada con `skills_create` o un archivo
 * añadido a `skills/` aparece sin reiniciar el servidor. Es una decisión
 * deliberada: reiniciar el MCP obliga a reiniciar el cliente de IA, y eso es
 * mucho peor que un `readdir` de más.
 */
export function registrarSkillsComoRecursos(server: McpServer): void {
  server.registerResource(
    "skills",
    ESQUEMA,
    {
      title: "Skills del usuario",
      description:
        "Instrucciones propias del usuario (convenciones de nombres, políticas, procedimientos) que el modelo debe seguir.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const slug = slugDeUri(uri.toString());
      if (!slug) {
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: `URI no reconocida. El formato es ${ESQUEMA}<slug>.`,
            },
          ],
        };
      }

      const skills = await cargarTodasLasSkills();
      const skill = skills.find((s) => s.slug === slug);

      if (!skill) {
        const disponibles = skills.map((s) => s.slug).join(", ") || "(ninguna)";
        return {
          contents: [
            {
              uri: uri.toString(),
              mimeType: "text/plain",
              text: `No existe ninguna skill con el slug '${slug}'. Skills disponibles: ${disponibles}.`,
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.toString(),
            mimeType: "text/markdown",
            text: `# ${skill.title}\n\n${skill.content}`,
          },
        ],
      };
    },
  );

  Logger.debug("Skills registradas como recursos MCP (skill://<slug>).");
}
