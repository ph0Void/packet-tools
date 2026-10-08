import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { prismaClient } from "@/prisma/lib/PrismaClient";

function calculateHash(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const DB_PATH = (process.env.DATABASE_URL ?? "").replace(/^file:/, "");

const DEV_DB_PATH = path.resolve(__dirname, "..", ".packet_tool_database.db");

function requireCopy(): void {
  if (!DB_PATH) throw new Error("Falta DATABASE_URL: apunta a una COPIA de la base de datos.");
  if (process.env.PT_ALLOW_MIGRATION_SCRIPT === "1") return;
  if (path.resolve(DB_PATH) === DEV_DB_PATH) {
    throw new Error(
      `DATABASE_URL apunta a la base de datos de DESARROLLO (${DEV_DB_PATH}). ` +
        "Este script escribe: usa una copia en un directorio temporal.",
    );
  }
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const PDF = Buffer.from("%PDF-1.4\ncontenido de prueba\n%%EOF", "utf8");

async function seedTestData(): Promise<void> {
  const user = await prismaClient.user.findFirst({ orderBy: { createdAt: "asc" } });
  if (!user) throw new Error("La copia no tiene usuarios: siembra antes de probar.");
  const chat = await prismaClient.chat.create({
    data: { userId: user.id, title: "Prueba de migración de adjuntos" },
  });
  const message = await prismaClient.message.create({
    data: { chatId: chat.id, role: "user", content: "mensaje con adjuntos antiguos" },
  });
  await prismaClient.attachment.createMany({
    data: [
      {
        messageId: message.id,
        fileName: "captura.png",
        fileType: "IMAGE",
        mimeType: "image/png",
        fileUrl: `data:image/png;base64,${PNG.toString("base64")}`,
      },
      {
        messageId: message.id,
        fileName: "manual.pdf",
        fileType: "DOCUMENT",
        mimeType: "application/pdf",
        fileUrl: `data:application/pdf;base64,${PDF.toString("base64")}`,
      },
      {
        messageId: message.id,
        fileName: "viejo.html",
        fileType: "DOCUMENT",
        mimeType: "text/html",
        fileUrl: "data:text/html;base64,PGgxPm9sPC9oMT4=",
      },
    ],
  });
  console.log(`Sembrado: chat ${chat.id}, mensaje ${message.id}, 3 adjuntos (2 migrables).`);
}

function runMigrationScript(args: string[]): string {
  const monorepoRoot = path.resolve(__dirname, "..", "..", "..");
  const cli = path.join(monorepoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  return execFileSync(process.execPath, [cli, "scripts/migrate-adjuntos.ts", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
  });
}

async function fetchState(): Promise<
  Array<{ fileName: string; storagePath: string | null; sha256: string | null; bytes: number | null; userId: string | null; fileUrl: string | null }>
> {
  const chat = await prismaClient.chat.findFirst({
    where: { title: "Prueba de migración de adjuntos" },
    orderBy: { createdAt: "desc" },
  });
  if (!chat) return [];
  const messages = await prismaClient.message.findMany({ where: { chatId: chat.id } });
  const attachments = await prismaClient.attachment.findMany({
    where: { messageId: { in: messages.map((messageItem) => messageItem.id) } },
  });
  return attachments.map((attachment) => ({
    fileName: attachment.fileName,
    storagePath: attachment.storagePath,
    sha256: attachment.sha256,
    bytes: attachment.sizeBytes,
    userId: attachment.userId,
    fileUrl: attachment.fileUrl,
  }));
}

async function main(): Promise<void> {
  requireCopy();
  const action = process.argv[2] ?? "";

  if (action === "sembrar") {
    await seedTestData();
    return;
  }

  if (action === "dry-run") {
    const before = await fetchState();
    const output = runMigrationScript(["--dry-run"]);
    console.log(output);
    const after = await fetchState();
    console.log("---");
    console.log("Estado idéntico tras el dry-run:", JSON.stringify(before) === JSON.stringify(after));
    return;
  }

  if (action === "aplicar") {
    console.log(runMigrationScript([]));
    const attachments = await fetchState();
    console.log("---");
    for (const attachment of attachments) {
      console.log(
        `${attachment.fileName}: storagePath=${attachment.storagePath ?? "NULL"} sha256=${(attachment.sha256 ?? "NULL").slice(0, 12)} ` +
          `bytes=${attachment.bytes ?? "NULL"} userId=${attachment.userId ?? "NULL"} fileUrl=${attachment.fileUrl ? "data-URL" : "NULL"}`,
      );
    }
    const before = JSON.stringify(attachments);
    console.log(runMigrationScript([]));
    const after = JSON.stringify(await fetchState());
    console.log("Segunda pasada idéntica (idempotente):", before === after);
    return;
  }

  if (action === "leer") {
    const { DIRECTORIO_ADJUNTOS, bytesCoincidenConMime, leerAdjuntoDeDisco } = await import(
      "@/api/router/adjuntos"
    );
    const chat = await prismaClient.chat.findFirst({
      where: { title: "Prueba de migración de adjuntos" },
      orderBy: { createdAt: "desc" },
    });
    if (!chat) throw new Error("No hay chat de prueba: ejecuta primero `sembrar`.");
    const messages = await prismaClient.message.findMany({ where: { chatId: chat.id } });
    const attachments = await prismaClient.attachment.findMany({
      where: { messageId: { in: messages.map((messageItem) => messageItem.id) } },
    });
    for (const attachment of attachments) {
      if (!attachment.storagePath) {
        console.log(`${attachment.fileName}: sin storagePath (no migrado, se sirve desde fileUrl)`);
        continue;
      }
      const bytes = await leerAdjuntoDeDisco(DIRECTORIO_ADJUNTOS, attachment.storagePath);
      const matches = bytes !== null && attachment.sha256 === calculateHash(bytes);
      console.log(
        `${attachment.fileName}: leído=${bytes ? bytes.length : "NO"} bytes · sha256 correcto=${matches} · ` +
          `mime coherente=${bytes ? bytesCoincidenConMime(bytes, attachment.mimeType ?? "") : "n/a"}`,
      );
    }
    return;
  }

  if (action === "revertir") {
    console.log(runMigrationScript(["--revert"]));
    const attachments = await fetchState();
    console.log("---");
    for (const attachment of attachments) {
      console.log(
        `${attachment.fileName}: storagePath=${attachment.storagePath ?? "NULL"} fileUrl=${
          attachment.fileUrl ? `data-URL (${attachment.fileUrl.length} chars)` : "NULL"
        }`,
      );
    }
    return;
  }

  console.log("Uso: tsx scripts/probar-migracion-adjuntos.ts <sembrar|dry-run|aplicar|leer|revertir>");
  process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error("[probar-migracion-adjuntos]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prismaClient.$disconnect();
  });
