

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestContext } from "@/utils/RequestContext";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  buildSkillsCatalog,
  buildSkillsFilesRecord,
  clearSkillsCache,
  invalidateSkillsCache,
  loadSkillsFromKnowledgeBase,
  serializeSkillMd,
  slugify,
} from "@/agent/skills/loader";
import { SKILL_TOOLS, SKILL_TOOLS_STAFF } from "@/agent/skills/tools";
import { getToolPolicy } from "@/agent/security/ToolPolicy";

let adminUserId = "";

async function invocarSkill<T>(
  role: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const tool = SKILL_TOOLS.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Tool desconocida: ${toolName}`);
  return (await requestContext.run(
    {
      id: adminUserId,
      username: `test_${role.toLowerCase()}`,
      role,
      approvalChannel: { chatId: "chat-test", emit: () => {} },
    } as never,
    () => tool.invoke(args) as Promise<T>,
  )) as T;
}

const titleTest = `vitest skill ${Date.now()}`;

beforeEach(async () => {
  clearSkillsCache();
  const user = await prismaClient.user.findUnique({
    where: { username: "vitest_suite_admin" },
    select: { id: true },
  });
  adminUserId =
    user?.id ??
    (
      await prismaClient.user.create({
        data: { username: "vitest_suite_admin", password: "x", role: "ADMIN" },
      })
    ).id;
});

afterEach(async () => {
  await prismaClient.knowledgeBase.deleteMany({ where: { title: titleTest } });
  clearSkillsCache();
});

afterAll(() => {
  clearSkillsCache();
});

describe("slugify: especificación de Agent Skills", () => {
  it("normaliza a minúsculas, guiones y sin acentos", () => {
    expect(slugify("Configurar OSPF Área 0")).toBe("configurar-ospf-area-0");
    expect(slugify("VLANs & Switching")).toBe("vlans-switching");
    expect(slugify("  espacios  raros  ")).toBe("espacios-raros");
  });

  it("nunca deja guiones al principio, al final ni duplicados", () => {
    expect(slugify("---hola---")).toBe("hola");
    expect(slugify("a___b")).toBe("a-b");
  });

  it("cae a un nombre válido si el título no tiene caracteres utilizables", () => {
    expect(slugify("¿¿¿")).toBe("skill");
  });

  it("respeta el límite de 64 caracteres", () => {
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(64);
  });
});

describe("serializeSkillMd: frontmatter", () => {
  it("añade frontmatter con name y description", () => {
    const md = serializeSkillMd({
      name: "ospf",
      description: "Configura OSPF",
      content: "# Pasos\n1. Configurar...",
    });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: ospf");
    expect(md).toContain('description: "Configura OSPF"');
    expect(md).toContain("# Pasos");
  });

  it("respeta el frontmatter propio si el contenido ya lo trae", () => {
    const withFrontmatter = "---\nname: custom\ndescription: ya está\n---\n\n# Body";
    expect(
      serializeSkillMd({ name: "otro", description: "x", content: withFrontmatter }),
    ).toBe(withFrontmatter);
  });
});

describe("loader: catálogo y filesystem virtual", () => {
  it("proyecta las skills a /skills/<slug>/SKILL.md con el formato de FileData", async () => {
    await prismaClient.knowledgeBase.create({
      data: {
        title: titleTest,
        description: "Skill de prueba",
        content: "Contenido de la skill",
        type: "SKILL",
        createdById: adminUserId,
      },
    });
    invalidateSkillsCache();

    const files = await buildSkillsFilesRecord();
    const slug = slugify(titleTest);
    const route = `/skills/${slug}/SKILL.md`;
    expect(files[route]).toBeDefined();
    expect(files[route].content).toContain("Contenido de la skill");
    expect(files[route].mimeType).toBe("text/markdown");
    expect(typeof files[route].modified_at).toBe("string");
  });

  it("el catálogo del prompt NO incluye el contenido completo (progressive disclosure)", async () => {
    await prismaClient.knowledgeBase.create({
      data: {
        title: titleTest,
        description: "Descripción breve",
        content: "SECRETO_UNICO_DE_LA_SKILL",
        type: "SKILL",
        createdById: adminUserId,
      },
    });
    invalidateSkillsCache();

    const catalogo = await buildSkillsCatalog();
    expect(catalogo).toContain(slugify(titleTest));
    expect(catalogo).toContain("Descripción breve");

    expect(catalogo).not.toContain("SECRETO_UNICO_DE_LA_SKILL");
  });

  it("no incluye los documentos DATA en el catálogo de skills", async () => {
    const documento = await prismaClient.knowledgeBase.create({
      data: {
        title: `${titleTest} doc`,
        content: "contenido de documento",
        type: "DATA",
        createdById: adminUserId,
      },
    });
    invalidateSkillsCache();
    const skills = await loadSkillsFromKnowledgeBase();
    expect(skills.find((s) => s.id === documento.id)).toBeUndefined();
    await prismaClient.knowledgeBase.delete({ where: { id: documento.id } });
  });
});

describe("tools de skills: idempotencia, invalidación y roles", () => {
  it("STAFF no recibe la tool de borrado", () => {
    expect(SKILL_TOOLS_STAFF.map((t) => t.name)).not.toContain("deleteSkill");
    expect(SKILL_TOOLS.map((t) => t.name)).toContain("deleteSkill");
  });

  it("crear la misma skill dos veces devuelve la existente", async () => {
    const first = JSON.parse(
      await invocarSkill<string>("ADMIN", "createSkill", {
        title: titleTest,
        description: "Primera",
        content: "v1",
      }),
    ) as { created: boolean; skill: { id: string } };

    const second = JSON.parse(
      await invocarSkill<string>("ADMIN", "createSkill", {
        title: titleTest,
        description: "Segunda",
        content: "v2",
      }),
    ) as { created: boolean; reason: string; skill: { id: string } };

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.reason).toContain("Ya existe");
    expect(second.skill.id).toBe(first.skill.id);

    const enBd = await prismaClient.knowledgeBase.count({
      where: { type: "SKILL", title: titleTest },
    });
    expect(enBd).toBe(1);

    const row = await prismaClient.knowledgeBase.findUnique({
      where: { id: first.skill.id },
    });
    expect(row?.content).toBe("v1");
  });

  it("crear una skill la hace disponible sin reiniciar (caché invalidada)", async () => {

    clearSkillsCache();
    const before = Object.keys(await buildSkillsFilesRecord()).filter((route) =>
      route.includes(slugify(titleTest)),
    );
    expect(before).toHaveLength(0);

    await invocarSkill<string>("ADMIN", "createSkill", {
      title: titleTest,
      description: "Skill recién creada",
      content: "pasos",
    });


    const after = await buildSkillsFilesRecord();
    expect(Object.keys(after).length).toBeGreaterThan(0);
    expect(
      Object.keys(after).some((route) => route.includes(slugify(titleTest))),
    ).toBe(true);
  });

  it("USER no puede crear skills", async () => {
    const output = JSON.parse(
      await invocarSkill<string>("USER", "createSkill", {
        title: titleTest,
        content: "x",
      }),
    ) as { success: boolean; error: string };
    expect(output.success).toBe(false);
    expect(output.error).toContain("ADMIN o STAFF");
  });

  it("STAFF no puede borrar skills (reservado a ADMIN)", async () => {
    const created = JSON.parse(
      await invocarSkill<string>("ADMIN", "createSkill", {
        title: titleTest,
        content: "x",
      }),
    ) as { skill: { id: string } };

    const output = JSON.parse(
      await invocarSkill<string>("STAFF", "deleteSkill", { id: created.skill.id }),
    ) as { success: boolean; error: string };
    expect(output.success).toBe(false);
    expect(output.error).toContain("ADMIN");
  });

  it("políticas: crear/editar skill es reversible, borrar no", () => {
    expect(getToolPolicy("createSkill").autoApprove).toBe(true);
    expect(getToolPolicy("updateSkill").autoApprove).toBe(true);
    expect(getToolPolicy("deleteSkill").autoApprove).toBeUndefined();
    expect(getToolPolicy("deleteSkill").access).toBe("mutating");
    expect(getToolPolicy("listSkills").access).toBe("readonly");
  });
});
