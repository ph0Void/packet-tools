

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeepAgent } from "deepagents";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buildTurnContextPrompt } from "@/agent/deep/DeepSupervisor";
import {
  buildSkillsCatalog,
  clearSkillsCache,
  invalidateSkillsCache,
  SKILLS_ROOT,
  slugify,
} from "@/agent/skills/loader";
import {
  buildSkillsSection,
  SKILLS_SECTION_HEADER,
  skillsPromptMiddleware,
} from "@/agent/skills/middleware";
import { deepTurnContextSchema } from "@/agent/deep/context";
import { prismaClient } from "@/prisma/lib/PrismaClient";


const BOILERPLATE_LIBRERIA = [
  "web-research",
  "quantum computing",
  "Executing Skill Scripts",
];

const titleTest = `vitest catalogo skills ${Date.now()}`;
const slugTest = slugify(titleTest);

beforeEach(async () => {
  clearSkillsCache();
  const user = await prismaClient.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true },
  });
  const created = await prismaClient.knowledgeBase.create({
    data: {
      title: titleTest,
      description: "Skill de prueba del catalogo unico",
      content: "SECRETO_UNICO_DE_LA_SKILL",
      type: "SKILL",
      createdById: user!.id,
    },
  });
  invalidateSkillsCache();
  expect(created.id).toBeTruthy();
});

afterEach(async () => {
  await prismaClient.knowledgeBase.deleteMany({ where: { title: titleTest } });
  clearSkillsCache();
});

afterAll(() => {
  clearSkillsCache();
});


async function systemPromptOfMiddleware(): Promise<string> {
  const middleware = skillsPromptMiddleware();
  const hook = middleware.wrapModelCall as unknown as (
    request: unknown,
    handler: (request: { systemMessage: SystemMessage }) => Promise<AIMessage>,
  ) => Promise<AIMessage>;
  let capturado: SystemMessage | null = null;
  await hook(
    {
      model: {},
      messages: [],
      systemPrompt: "",
      systemMessage: new SystemMessage("PROMPT_BASE"),
      tools: [],
      state: { messages: [] },
      runtime: {},
    },
    async (request) => {
      capturado = request.systemMessage;
      return new AIMessage("ok");
    },
  );
  return String((capturado as unknown as SystemMessage).text ?? "");
}

describe("catalogo de skills: una sola fuente y una sola inyeccion", () => {
  it("el middleware se llama SkillsMiddleware (es lo que sustituye al de la libreria)", () => {

    expect(skillsPromptMiddleware().name).toBe("SkillsMiddleware");
  });

  it("el prompt dinamico del supervisor ya NO lleva el catalogo", async () => {
    const prompt = await buildTurnContextPrompt(
      deepTurnContextSchema.parse({ role: "ADMIN" }),
    );
    expect(prompt).not.toContain(SKILLS_SECTION_HEADER);
    expect(prompt).not.toContain(slugTest);

    const withSkill = await buildTurnContextPrompt(
      deepTurnContextSchema.parse({ role: "ADMIN", skillRequested: slugTest }),
    );
    expect(withSkill).toContain("/skills/" + slugTest + "/SKILL.md");
  });

  it("el middleware inyecta el catalogo una vez, con la lectura obligatoria del SKILL.md", async () => {
    const prompt = await systemPromptOfMiddleware();
    expect(prompt.startsWith("PROMPT_BASE")).toBe(true);
    const ocurrencias = prompt.split(SKILLS_SECTION_HEADER).length - 1;
    expect(ocurrencias).toBe(1);
    expect(prompt).toContain(slugTest);

    expect(prompt).toContain("read its SKILL.md with 'read_file'");
    expect(prompt).toContain("BEFORE acting");

    expect(prompt).not.toContain("SECRETO_UNICO_DE_LA_SKILL");
  });

  it("el texto inyectado no arrastra el boilerplate de la plantilla de deepagents", async () => {
    const prompt = await systemPromptOfMiddleware();
    for (const marker of BOILERPLATE_LIBRERIA) {
      expect(prompt).not.toContain(marker);
    }
    expect(buildSkillsSection("")).toBe("");
  });
});


class ModelEspia extends BaseChatModel {
  static systems: string[] = [];
  static ligadas: string[][] = [];

  constructor() {
    super({});
  }

  override _llmType(): string {
    return "espia";
  }

  override _combineLLMOutput(): never[] {
    return [] as never[];
  }

  override bindTools(tools: Array<{ name: string }>): this {
    ModelEspia.ligadas.push(tools.map((t) => t.name));
    return this;
  }

  override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const system = messages.find((m) => m.getType() === "system");
    ModelEspia.systems.push(String((system as SystemMessage)?.text ?? ""));
    return {
      generations: [
        { text: "ok", message: new AIMessage("ok"), generationInfo: {} },
      ],
    };
  }
}

describe("catalogo de skills contra la libreria real (deepagents)", () => {
  it("con skills:[...] el catalogo aparece UNA vez y sin el boilerplate de la libreria", async () => {
    ModelEspia.systems = [];
    ModelEspia.ligadas = [];
    const loadTools = tool(async () => "ok", {
      name: "load_tools",
      description: "herramienta de prueba",
      schema: z.object({ query: z.string().optional() }),
    });

    const agent = createDeepAgent({
      model: new ModelEspia() as never,
      systemPrompt: "PROMPT_BASE",
      tools: [loadTools],
      skills: [SKILLS_ROOT + "/"],
      middleware: [skillsPromptMiddleware() as never],
    });

    await agent.invoke(
      { messages: [new HumanMessage("hola")] },
      { recursionLimit: 20, configurable: { thread_id: "skills-unico" } },
    );

    expect(ModelEspia.systems.length).toBeGreaterThan(0);
    const prompt = ModelEspia.systems[0];
    expect(prompt.split(SKILLS_SECTION_HEADER).length - 1).toBe(1);
    expect(prompt).toContain(slugTest);
    expect(prompt).toContain("read its SKILL.md with 'read_file'");
    for (const marker of BOILERPLATE_LIBRERIA) {
      expect(prompt).not.toContain(marker);
    }

    expect(prompt).not.toContain("## Skills System");

    const ligadas = ModelEspia.ligadas[0] ?? [];
    expect(ligadas).toContain("read_file");
  }, 30000);

  it("el catalogo del loader es lo unico que se compone (no hay dos plantillas)", async () => {
    const catalogo = await buildSkillsCatalog();
    expect(catalogo.split(SKILLS_SECTION_HEADER).length - 1).toBe(1);
    expect(catalogo).toContain(slugTest);
  });
});
