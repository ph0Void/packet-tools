

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  DIRECTORIO_ADJUNTOS,
  ErrorAdjunto,
  bytesCoincidenConMime,
  calcularSha256,
  esMimeAdmitido,
  existeAdjuntoEnDisco,
  extensionDeMime,
  maximoCharsDataUrl,
  nombreSeguro,
  parsearDataUrl,
  persistirAdjuntosEntrantes,
  prepararAdjunto,
  resolverRutaDeAdjunto,
  rutaRelativaDeAdjunto,
  escribirAdjuntoEnDisco,
} from "@/api/router/adjuntos";
import { adminBearer, createTestUser, publicApi, removeTestUser } from "./helpers";




const PNG_1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);


function dataUrlPng(): string {
  return `data:image/png;base64,${PNG_1x1.toString("base64")}`;
}


function dataUrlPdf(content = "contenido de prueba"): string {
  const bytes = Buffer.from(`%PDF-1.4\n${content}\n%%EOF`, "utf8");
  return `data:application/pdf;base64,${bytes.toString("base64")}`;
}



const createdUsers: string[] = [];
const createdChatIds: string[] = [];

const archivosCreated: string[] = [];

afterAll(async () => {
  const bearer = await adminBearer();
  for (const id of createdChatIds) {
    await publicApi()
      .delete(`/api/chats/${id}`)
      .set("Authorization", bearer)
      .catch(() => undefined);
  }
  for (const username of createdUsers) await removeTestUser(username);

  for (const storagePath of archivosCreated) {
    const destino = resolverRutaDeAdjunto(DIRECTORIO_ADJUNTOS, storagePath);
    if (destino) await fs.rm(destino, { force: true }).catch(() => undefined);
  }
});

async function userWithSession() {
  const owner = await createTestUser("USER");
  createdUsers.push(owner.username);
  const login = await publicApi().post("/api/auth/login").send(owner);
  return (login.headers["set-cookie"]?.[0] ?? "").split(";")[0];
}

async function createChat(cookie: string, title: string): Promise<string> {
  const created = await publicApi().post("/api/chats").set("Cookie", cookie).send({ title: title });
  createdChatIds.push(created.body.data.id);
  return created.body.data.id;
}



describe("adjuntos: lista cerrada de mimes", () => {
  it("admite solo imagen y documento de la lista", () => {
    for (const mime of ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain", "text/markdown", "text/csv", "application/json"]) {
      expect(esMimeAdmitido(mime), mime).toBe(true);
    }

    for (const mime of ["text/html", "application/x-msdownload", "application/zip", "image/svg+xml", "", null, undefined]) {
      expect(esMimeAdmitido(mime as string), String(mime)).toBe(false);
    }
  });

  it("normaliza el mime (minúsculas y parámetros `; charset=`)", () => {
    expect(esMimeAdmitido("IMAGE/PNG")).toBe(true);
    expect(esMimeAdmitido("text/plain; charset=utf-8")).toBe(true);
    expect(extensionDeMime("text/plain; charset=utf-8")).toBe("txt");
  });

  it("la extensión sale del MIME, no del nombre que envía el cliente", () => {
    expect(extensionDeMime("image/png")).toBe("png");
    expect(extensionDeMime("image/jpeg")).toBe("jpg");

    expect(extensionDeMime("image/png")).not.toBe("html");
  });
});

describe("adjuntos: data-URL y tamaños", () => {
  it("parsea una data-URL base64 y devuelve los bytes y el mime", () => {
    const parseada = parsearDataUrl(dataUrlPng());
    expect(parseada.ok).toBe(true);
    if (!parseada.ok) return;
    expect(parseada.mime).toBe("image/png");
    expect(Buffer.compare(parseada.bytes, PNG_1x1)).toBe(0);
  });

  it("rechaza lo que no es una data-URL base64", () => {
    expect(parsearDataUrl("https://ejemplo.com/a.png").ok).toBe(false);
    expect(parsearDataUrl("data:image/png,sinbase64").ok).toBe(false);
    expect(parsearDataUrl("data:application/x-msdownload;base64,TVqQAAMAAAAEAAAA").ok).toBe(false);
  });

  it("rechaza base64 corrupto y payload vacío", () => {
    expect(parsearDataUrl("data:image/png;base64,%%%no-es-base64%%%")).toMatchObject({
      ok: false,
      reason: "base64_invalido",
    });
    expect(parsearDataUrl("data:image/png;base64,")).toMatchObject({ ok: false });
  });

  it("el tope del cuerpo es 2x4/3 del límite y el tamaño se mide en bytes", () => {

    expect(maximoCharsDataUrl(1000)).toBeGreaterThan(2666);
    const bytes = Buffer.alloc(1000, 0x41);
    const preparado = prepararAdjunto(
      { fileName: "a.txt", fileUrl: `data:text/plain;base64,${bytes.toString("base64")}` },
      4000,
    );
    expect(preparado.sizeBytes).toBe(1000);
  });

  it("un archivo 1 byte mayor que el límite es ADJUNTO_DEMASIADO_GRANDE (400)", () => {
    const bytes = Buffer.alloc(1000, 0x41);
    const error = (() => {
      try {
        prepararAdjunto(
          { fileName: "a.txt", fileUrl: `data:text/plain;base64,${bytes.toString("base64")}` },
          999,
        );
      } catch (e) {
        return e as ErrorAdjunto;
      }
      return null;
    })();
    expect(error?.codigo).toBe("ADJUNTO_DEMASIADO_GRANDE");
  });

  it("una data-URL por encima de 2x el límite es CUERPO_DEMASIADO_GRANDE (413)", () => {

    const enorme = `data:text/plain;base64,${"A".repeat(5000)}`;
    const error = (() => {
      try {
        prepararAdjunto({ fileName: "enorme.txt", fileUrl: enorme }, 1000);
      } catch (e) {
        return e as ErrorAdjunto;
      }
      return null;
    })();
    expect(error?.codigo).toBe("CUERPO_DEMASIADO_GRANDE");
  });

  it("comprueba que los bytes concuerden con el mime declarado", () => {
    expect(bytesCoincidenConMime(PNG_1x1, "image/png")).toBe(true);
    expect(bytesCoincidenConMime(PNG_1x1, "image/jpeg")).toBe(false);

expect(bytesCoincidenConMime(Buffer.from("%PDF-1.4"), "application/pdf")).toBe(true);
expect(bytesCoincidenConMime(Buffer.from("#PDF-1.4"), "application/pdf")).toBe(false);

    expect(bytesCoincidenConMime(Buffer.from("hola"), "text/plain")).toBe(true);
  });

  it("prepararAdjunto da un código estable por cada motivo de rechazo", () => {
    const max = 1024;
    
    const errorOf = (fn: () => unknown): ErrorAdjunto | null => {
      try {
        fn();
      } catch (error) {
        return error as ErrorAdjunto;
      }
      return null;
    };

    expect(errorOf(() => prepararAdjunto({ fileName: "a.png" }, max))?.codigo).toBe("ADJUNTO_SIN_DATOS");

    expect(
      errorOf(() => prepararAdjunto({ fileName: "a.png", fileUrl: "http://x/a.png" }, max))?.codigo,
    ).toBe("ADJUNTO_NO_ES_DATA_URL");

    expect(
      errorOf(() =>
        prepararAdjunto({ fileName: "a.html", fileUrl: "data:text/html;base64,PGI+PC9iPg==" }, max),
      )?.codigo,
    ).toBe("MIME_NO_ADMITIDO");

    expect(errorOf(() => prepararAdjunto({ fileName: "a.png", fileUrl: dataUrlPng() }, 4))?.codigo).toBe(
      "ADJUNTO_DEMASIADO_GRANDE",
    );

    expect(
      errorOf(() =>
        prepararAdjunto(
          {
            fileName: "a.png",
            fileUrl: `data:image/png;base64,${Buffer.from("%PDF-1.4").toString("base64")}`,
          },
          max,
        ),
      )?.codigo,
    ).toBe("BYTES_NO_COINCIDEN");
  });
});

describe("adjuntos: rutas y nombres", () => {
  it("la ruta sale del sha256 y es determinista (idempotencia de la migración)", () => {
    const sha = calcularSha256(PNG_1x1);
    const route = rutaRelativaDeAdjunto(sha, "image/png");
    expect(route).toBe(`${sha.slice(0, 2)}/${sha}.png`);

    expect(rutaRelativaDeAdjunto(calcularSha256(PNG_1x1), "image/png")).toBe(route);
  });

  it("no permite que storagePath salga de ATTACHMENTS_DIR (traversal)", () => {
    const base = DIRECTORIO_ADJUNTOS;
    expect(resolverRutaDeAdjunto(base, "aa/bb.png")).toContain("aa");
    expect(resolverRutaDeAdjunto(base, "../../.env")).toBeNull();
    expect(resolverRutaDeAdjunto(base, "../../../package.json")).toBeNull();
    expect(resolverRutaDeAdjunto(base, "/etc/passwd")).toBeNull();
    expect(resolverRutaDeAdjunto(base, "")).toBeNull();
  });

  it("sanea el nombre del cliente para la cabecera de descarga", () => {
    expect(nombreSeguro("captura.png")).toBe("captura.png");
    expect(nombreSeguro("../../etc/passwd")).toBe("passwd");
    expect(nombreSeguro("con espacio y ; coma")).toBe("con_espacio_y___coma");
    expect(nombreSeguro("")).toBe("adjunto");
    expect(nombreSeguro("x".repeat(400)).length).toBeLessThanOrEqual(120);
  });

  it("escribirAdjuntoEnDisco es idempotente y avisa de si creó el archivo", async () => {
    const base = path.join(DIRECTORIO_ADJUNTOS, "test-escritura");
    const preparado = prepararAdjunto({ fileName: "p.png", fileUrl: dataUrlPng() }, 1024 * 1024);
    const first = await escribirAdjuntoEnDisco(base, preparado);
    expect(first.creado).toBe(true);
    expect(await existeAdjuntoEnDisco(base, first.storagePath)).toBe(true);


    const second = await escribirAdjuntoEnDisco(base, preparado);
    expect(second.creado).toBe(false);
    expect(second.storagePath).toBe(first.storagePath);


    const leido = await fs.readFile(resolverRutaDeAdjunto(base, first.storagePath)!);
    expect(Buffer.compare(leido, PNG_1x1)).toBe(0);

    await fs.rm(base, { recursive: true, force: true });
  });

  it("persistirAdjuntosEntrantes no deja archivos a medias si un adjunto falla", async () => {
    const base = path.join(DIRECTORIO_ADJUNTOS, "test-lote");

    const error = await persistirAdjuntosEntrantes(
      base,
      [
        { fileName: "ok.png", fileUrl: dataUrlPng() },
        { fileName: "malo.html", fileUrl: "data:text/html;base64,PGI+PC9iPg==" },
      ],
      1024 * 1024,
    ).then(
      () => null,
      (e: unknown) => e as ErrorAdjunto,
    );
    expect(error).toBeTruthy();
    expect(error!.codigo).toBe("MIME_NO_ADMITIDO");


    const restos = await fs.readdir(base, { recursive: true } as never).catch(() => [] as string[]);
    expect(restos).toHaveLength(0);
    await fs.rm(base, { recursive: true, force: true });
  });
});



describe("POST /:id/messages con adjuntos en disco", () => {
  it("guarda el contenido en disco y solo metadata en la base de datos", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Adjunto en disco");
    const sha = calcularSha256(PNG_1x1);

    const reply = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({
        content: "mira esta captura",
        stream: false,
        attachments: [{ fileName: "captura.png", fileType: "IMAGE", fileUrl: dataUrlPng() }],
      });
    expect(reply.status).toBe(201);

    const attachment = reply.body.data.attachments[0];

    expect(attachment.storagePath).toBe(`${sha.slice(0, 2)}/${sha}.png`);
    expect(attachment.sha256).toBe(sha);
    expect(attachment.sizeBytes).toBe(PNG_1x1.length);
    expect(attachment.mimeType).toBe("image/png");
    expect(attachment.userId).toBeTruthy();
    expect(attachment.fileUrl).toBeNull();


    const destino = resolverRutaDeAdjunto(DIRECTORIO_ADJUNTOS, attachment.storagePath)!;
    expect(destino.startsWith(DIRECTORIO_ADJUNTOS)).toBe(true);
    const leido = await fs.readFile(destino);
    expect(Buffer.compare(leido, PNG_1x1)).toBe(0);
    archivosCreated.push(attachment.storagePath);
  }, 30000);

  it("acepta un documento y conserva su mime", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Documento en disco");
    const reply = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({
        content: "revisa este PDF",
        stream: false,
        attachments: [{ fileName: "manual.pdf", fileType: "DOCUMENT", fileUrl: dataUrlPdf() }],
      });
    expect(reply.status).toBe(201);
    const attachment = reply.body.data.attachments[0];
    expect(attachment.mimeType).toBe("application/pdf");
    expect(attachment.fileType).toBe("DOCUMENT");
    expect(attachment.fileUrl).toBeNull();
    if (attachment.storagePath) archivosCreated.push(attachment.storagePath);
  }, 30000);
});

describe("GET /api/chats/attachments/:id", () => {
  it("sirve el adjunto con el mime correcto y Cache-Control privado", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Descarga de adjunto");
    const sent = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({
        content: "captura",
        stream: false,
        attachments: [{ fileName: "captura.png", fileType: "IMAGE", fileUrl: dataUrlPng() }],
      });
    const attachmentId = sent.body.data.attachments[0].id;

    const descarga = await publicApi()
      .get(`/api/chats/attachments/${attachmentId}`)
      .set("Cookie", cookie);
    expect(descarga.status).toBe(200);
    expect(descarga.headers["content-type"]).toContain("image/png");
    expect(descarga.headers["cache-control"]).toContain("private");
    expect(descarga.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.from(descarga.body)).toEqual(PNG_1x1);
  }, 30000);

  it("otro usuario NO puede descargarlo (404, sin revelar que existe)", async () => {
    const owner = await userWithSession();
    const chatId = await createChat(owner, "Adjunto privado");
    const sent = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", owner)
      .send({
        content: "privado",
        stream: false,
        attachments: [{ fileName: "captura.png", fileType: "IMAGE", fileUrl: dataUrlPng() }],
      });
    const attachmentId = sent.body.data.attachments[0].id;

    const intruder = await userWithSession();
    const reply = await publicApi()
      .get(`/api/chats/attachments/${attachmentId}`)
      .set("Cookie", intruder);
    expect(reply.status).toBe(404);

    const inexistente = await publicApi()
      .get("/api/chats/attachments/no-existe-xyz")
      .set("Cookie", intruder);
    expect(inexistente.status).toBe(404);
  }, 30000);

  it("un ADMIN sí puede descargarlo (soporte)", async () => {
    const owner = await userWithSession();
    const chatId = await createChat(owner, "Adjunto con admin");
    const sent = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", owner)
      .send({
        content: "para soporte",
        stream: false,
        attachments: [{ fileName: "captura.png", fileType: "IMAGE", fileUrl: dataUrlPng() }],
      });
    const attachmentId = sent.body.data.attachments[0].id;
    const reply = await publicApi()
      .get(`/api/chats/attachments/${attachmentId}`)
      .set("Authorization", await adminBearer());
    expect(reply.status).toBe(200);
  }, 30000);

  it("exige autenticación (401 sin sesión)", async () => {
    const reply = await publicApi().get("/api/chats/attachments/cualquiera");
    expect([401, 403]).toContain(reply.status);
  });
});

describe("POST /:id/messages: límites y validación de adjuntos", () => {
  it("un mime fuera de la lista cerrada es 400 y no crea el mensaje", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Mime prohibido");
    const reply = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({
        content: "te paso un html",
        stream: false,
        attachments: [{ fileName: "x.html", fileUrl: "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" }],
      });
    expect(reply.status).toBe(400);
    expect(reply.body.code).toBe("MIME_NO_ADMITIDO");
    const messages = await prismaClient.message.findMany({ where: { chatId } });
    expect(messages).toHaveLength(0);
  }, 30000);

  it("superar ATTACHMENT_MAX_BYTES (10 MB) es 400 con el código del límite", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Excede el límite");


    const bytes = Buffer.alloc(11 * 1024 * 1024, 0x20);
    PNG_1x1.copy(bytes, 0);
    const reply = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({
        content: "archivo grande",
        stream: false,
        attachments: [
          { fileName: "grande.png", fileUrl: `data:image/png;base64,${bytes.toString("base64")}` },
        ],
      });
    expect(reply.status).toBe(400);
    expect(reply.body.code).toBe("ADJUNTO_DEMASIADO_GRANDE");
    expect(typeof reply.body.message).toBe("string");

    expect(await prismaClient.message.findMany({ where: { chatId } })).toHaveLength(0);
    expect(await prismaClient.attachment.findMany({ where: { message: { chatId } } })).toHaveLength(0);
  }, 60000);

  it("un adjunto sin contenido es 400 (no se persiste una fila vacía)", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Adjunto vacío");
    const reply = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({
        content: "adjunto sin bytes",
        stream: false,
        attachments: [{ fileName: "vacio.png" }],
      });
    expect(reply.status).toBe(400);
    expect(reply.body.code).toBe("ADJUNTO_SIN_DATOS");
    expect(await prismaClient.message.findMany({ where: { chatId } })).toHaveLength(0);
  }, 30000);

  it("una data-URL gigante en la petición es 413 sin llegar a decodificarla", async () => {
    const cookie = await userWithSession();
    const chatId = await createChat(cookie, "Data-URL gigante");

    const gigante = `data:text/plain;base64,${"A".repeat(30 * 1024 * 1024)}`;
    const reply = await publicApi()
      .post(`/api/chats/${chatId}/messages`)
      .set("Cookie", cookie)
      .send({
        content: "enorme",
        stream: false,
        attachments: [{ fileName: "enorme.txt", fileUrl: gigante }],
      });
    expect(reply.status).toBe(413);
    expect(reply.body.code).toBe("CUERPO_DEMASIADO_GRANDE");
    expect(await prismaClient.message.findMany({ where: { chatId } })).toHaveLength(0);
  }, 60000);
});
