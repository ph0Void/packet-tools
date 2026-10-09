
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { cargarTodasLasSkills } from "./SkillLoader";
import { Logger } from "@/utils/Logger";


const ESQUEMA = "skill://";


function slugDeUri(uri: string): string | null {
  if (!uri.startsWith(ESQUEMA)) return null;
  const slug = uri.slice(ESQUEMA.length).trim();
  return slug.length > 0 ? slug : null;
}


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
