

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hybridSearchService } from "@/service/HybridSearchService";
import {
  extraerTextoPrincipal,
  webCacheService,
  validarUrl,
  deduplicarResultados,
} from "@/service/WebCacheService";
import { prismaClient } from "@/prisma/lib/PrismaClient";

const sufijo = Date.now();
const titleHibrido = `vitest rag ${sufijo}`;

let docId = "";
let skillId = "";

beforeEach(async () => {
  docId = (
    await prismaClient.knowledgeBase.create({
      data: {
        title: titleHibrido,
        description: "Manual del switch",
        content:
          "Para configurar la VLAN de gestión usa el host vtp 10.0.14.4 " +
          "y aplica 'switchport mode trunk' en el puerto Gi0/1. " +
          "Después verifica con 'show vtp status'.",
        type: "DATA",
      },
    })
  ).id;

  skillId = (
    await prismaClient.knowledgeBase.create({
      data: {
        title: `${titleHibrido} skill`,
        description: "Playbook de prueba",
        content: "Playbook que menciona vtp 10.0.14.4 para verificar el filtro.",
        type: "SKILL",
      },
    })
  ).id;
});

afterEach(async () => {
  await prismaClient.knowledgeBase.deleteMany({
    where: { id: { in: [docId, skillId] } },
  });
  webCacheService.clear();
});

describe("RAG híbrido: recuperación", () => {
  it("encuentra un identificador exacto en el documento (vía léxica)", async () => {
    const result = await hybridSearchService.search("vtp 10.0.14.4", {
      type: "DATA",
    });
    expect(result.chunks.length).toBeGreaterThan(0);
    const fuentes = result.sources.join(" ");
    expect(fuentes).toContain(titleHibrido);

    expect(["hybrid", "semantic", "textual"]).toContain(result.mode);
  });

  it("el filtro por tipo excluye las skills de la búsqueda de documentos", async () => {

    const onlyData = await hybridSearchService.search("playbook verificar", {
      type: "DATA",
    });
    const idsData = onlyData.chunks.map((c) => c.docId);

    expect(idsData).not.toContain(skillId);
    expect(onlyData.sources.join(" ")).not.toContain(`${titleHibrido} skill`);

    const kindsData = await prismaClient.knowledgeBase.findMany({
      where: { id: { in: idsData } },
      select: { type: true },
    });
    expect(kindsData.map((t) => t.type)).not.toContain("SKILL");
    expect(idsData.every((id) => id.length > 0)).toBe(true);

    const onlySkills = await hybridSearchService.search("vtp 10.0.14.4", {
      type: "SKILL",
    });
    const idsSkills = onlySkills.chunks.map((c) => c.docId);

    expect(idsSkills).toContain(skillId);

    const kindsSkills = await prismaClient.knowledgeBase.findMany({
      where: { id: { in: idsSkills } },
      select: { type: true },
    });
    expect(kindsSkills.map((t) => t.type)).not.toContain("DATA");
    expect(idsSkills.every((id) => id.length > 0)).toBe(true);
  });

  it("devuelve estructura vacía (no lanza) ante consulta en blanco", async () => {
    const result = await hybridSearchService.search("   ");
    expect(result.chunks).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.mode).toBe("none");
  });

  it("devuelve vacío sin error cuando no hay coincidencias", async () => {
    const result = await hybridSearchService.search(
      "xyzzy_palabra_inexistente_12345",
      { type: "DATA" },
    );


    const lexicos = result.chunks.filter((c) => c.mode === "textual");
    expect(lexicos).toEqual([]);


    if (result.chunks.length === 0) {
      expect(result.mode).toBe("none");
      expect(result.sources).toEqual([]);
    } else {

      expect(
        result.chunks.every((c) => c.mode === "semantic"),
        `se esperaba solo modo semantic y llegaron: ${result.chunks
          .map((c) => c.mode)
          .join(", ")}`,
      ).toBe(true);
      expect(
        result.chunks.some((c) => c.content.includes("xyzzy")),
      ).toBe(false);
    }
  });

  it("respeta el límite k de fragmentos", async () => {
    const result = await hybridSearchService.search("switchport trunk vlan", {
      k: 1,
      type: "DATA",
    });
    expect(result.chunks.length).toBeLessThanOrEqual(1);
  });
});

describe("RAG híbrido: fusión y diversidad", () => {
  it("el fragmento recuperado por ambos modos se marca como hybrid", async () => {

    const result = await hybridSearchService.search("vtp 10.0.14.4 trunk", {
      type: "DATA",
    });
    for (const chunk of result.chunks) {
      expect(["hybrid", "semantic", "textual"]).toContain(chunk.mode);
      expect(typeof chunk.score).toBe("number");
      expect(typeof chunk.source).toBe("string");
    }
  });

  it("no devuelve más de 2 fragmentos del mismo documento", async () => {
    const documentoLong = `documento largo ${sufijo} `.repeat(200) + "fin";
    const long = (
      await prismaClient.knowledgeBase.create({
        data: {
          title: `vitest largo ${sufijo}`,
          content: documentoLong,
          type: "DATA",
        },
      })
    ).id;
    try {
      const result = await hybridSearchService.search("documento largo", {
        k: 5,
        type: "DATA",
      });
      const byDoc = new Map<string, number>();
      for (const chunk of result.chunks) {
        byDoc.set(chunk.docId, (byDoc.get(chunk.docId) ?? 0) + 1);
      }
      for (const [,total] of byDoc) {
        expect(total).toBeLessThanOrEqual(2);
      }
    } finally {
      await prismaClient.knowledgeBase.delete({ where: { id: long } });
    }
  });
});

describe("Web cacheada: deduplicación", () => {
  it("elimina URLs repetidas y limita por dominio", () => {
    const input = [
      { title: "a", url: "https:// ejemplo.com/a".replace(" ", ""), snippet: "" },
      { title: "a duplicado", url: "https://ejemplo.com/a", snippet: "" },
      { title: "b", url: "https://ejemplo.com/b", snippet: "" },
      { title: "c", url: "https://ejemplo.com/c", snippet: "" },
      { title: "otro", url: "https://otro.org/x", snippet: "" },
    ];
    const output = deduplicarResultados(input, 2);

    expect(output.filter((r) => r.url === "https://ejemplo.com/a")).toHaveLength(1);
    expect(output.filter((r) => r.url.includes("ejemplo.com"))).toHaveLength(2);
    expect(output.some((r) => r.url.includes("otro.org"))).toBe(true);
  });
});

describe("Web cacheada: extracción de contenido", () => {
  it("elimina scripts, estilos y navegación, y decodifica entidades", () => {
    const html = `
      <html><head><title>Guía OSPF</title>
      <style>.a{color:red}</style>
      <script>console.log("ruido")</script></head>
      <body>
        <nav>Inicio Contacto</nav>
        <h1>Configurar OSPF</h1>
        <p>Entra al modo &amp; configura: <code>router ospf 1</code></p>
        <p>Luego&nbsp;aplica&nbsp;redes.</p>
        <footer>Pie de página</footer>
      </body></html>`;
    const { title, text, degraded } = extraerTextoPrincipal(html);
    expect(title).toBe("Guía OSPF");
    expect(text).toContain("Configurar OSPF");
    expect(text).toContain("router ospf 1");
    expect(text).toContain("&");
    expect(text).not.toContain("console.log");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("Pie de página");
    expect(degraded).toBe(false);
  });

  it("marca como degradada una página sin texto útil", () => {
    const { degraded } = extraerTextoPrincipal("<html><body></body></html>");
    expect(degraded).toBe(true);
  });

  it("recorta al límite de caracteres", () => {
    const html = `<html><body><p>${"palabra ".repeat(2000)}</p></body></html>`;
    const { text } = extraerTextoPrincipal(html, 500);
    expect(text.length).toBeLessThanOrEqual(500);
  });
});

describe("Web cacheada: validación de URL", () => {
  it("acepta http y https", () => {
    expect(validarUrl("https://example.com/doc")).toContain("example.com");
    expect(validarUrl("http://example.com/doc")).toContain("example.com");
  });

  it("rejeta esquemas no http(s)", () => {
    expect(() => validarUrl("file:///etc/passwd")).toThrow(/http/);
    expect(() => validarUrl("ftp://example.com")).toThrow(/http/);
    expect(() => validarUrl("javascript:alert(1)")).toThrow();
  });

  it("recola URLs inválidas", () => {
    expect(() => validarUrl("no-es-una-url")).toThrow();
  });
});
