import { createMiddleware, type AgentMiddleware } from "langchain";
import { SystemMessage } from "@langchain/core/messages";
import { buildSkillsCatalog, SKILLS_SECTION_HEADER } from "./loader";

export { SKILLS_SECTION_HEADER };

export function buildSkillsSection(catalogo: string): string {
  if (!catalogo) return "";
  return [

    "\n\n" + catalogo,
    "",
    "How to use them (progressive disclosure): the list above only gives name and description. When a request matches one, read its SKILL.md with 'read_file' (pass limit=200) BEFORE acting, then follow the procedure it describes. Do not guess its content and do not repeat information already in the conversation.",
  ].join("\n");
}

export function skillsPromptMiddleware(): AgentMiddleware {
  return createMiddleware({
    name: "SkillsMiddleware",
    wrapModelCall: async (request, handler) => {
      const catalogo = await buildSkillsCatalog();
      const seccion = buildSkillsSection(catalogo);
      if (!seccion) return handler(request);
      const sistema: SystemMessage =
        request.systemMessage instanceof SystemMessage
          ? request.systemMessage
          : new SystemMessage(String(request.systemMessage ?? ""));
      return handler({
        ...request,
        systemMessage: sistema.concat(seccion),
      });
    },
  });
}
