"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registrarSkillsComoRecursos = registrarSkillsComoRecursos;
const SkillLoader_1 = require("./SkillLoader.js");
const Logger_1 = require("../utils/Logger.js");
const ESQUEMA = "skill://";
function slugDeUri(uri) {
    if (!uri.startsWith(ESQUEMA))
        return null;
    const slug = uri.slice(ESQUEMA.length).trim();
    return slug.length > 0 ? slug : null;
}
function registrarSkillsComoRecursos(server) {
    server.registerResource("skills", ESQUEMA, {
        title: "Skills del usuario",
        description: "Instrucciones propias del usuario (convenciones de nombres, políticas, procedimientos) que el modelo debe seguir.",
        mimeType: "text/markdown",
    }, async (uri) => {
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
        const skills = await (0, SkillLoader_1.cargarTodasLasSkills)();
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
    });
    Logger_1.Logger.debug("Skills registradas como recursos MCP (skill://<slug>).");
}
//# sourceMappingURL=SkillResources.js.map