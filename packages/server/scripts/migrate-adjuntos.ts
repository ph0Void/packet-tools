import { prismaClient } from "@/prisma/lib/PrismaClient";
import {
  DIRECTORIO_ADJUNTOS,
  calcularSha256,
  escribirAdjuntoEnDisco,
  leerAdjuntoDeDisco,
  nombreSeguro,
  parsearDataUrl,
  rutaRelativaDeAdjunto,
} from "@/api/router/adjuntos";

interface MigrationResult {
  id: string;
  status: "migrado" | "omitido";
  reason?: string;
  storagePath?: string;
  bytes?: number;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function summarizeReason(reason: string): string {
  return reason.length > 90 ? `${reason.slice(0, 87)}…` : reason;
}

async function migrate(dryRun: boolean): Promise<void> {
  const candidates = await prismaClient.attachment.findMany({
    where: { storagePath: null },
    include: { message: { select: { chat: { select: { userId: true } } } } },
    orderBy: { createdAt: "asc" },
  });

  const results: MigrationResult[] = [];
  let migratedCount = 0;
  let skippedCount = 0;
  let totalBytes = 0;

  for (const row of candidates) {
    const dataUrl = typeof row.fileUrl === "string" ? row.fileUrl : "";
    if (!dataUrl) {
      results.push({ id: row.id, status: "omitido", reason: "sin fileUrl que migrar" });
      skippedCount += 1;
      continue;
    }
    const parsed = parsearDataUrl(dataUrl);
    if (!parsed.ok) {
      results.push({
        id: row.id,
        status: "omitido",
        reason:
          parsed.motivo === "mime_desconocido"
            ? "mime fuera de la lista cerrada: no se puede clasificar el archivo"
            : `data-URL ilegible (${parsed.motivo})`,
      });
      skippedCount += 1;
      continue;
    }
    const sha256 = calcularSha256(parsed.bytes);
    const targetPath = rutaRelativaDeAdjunto(sha256, parsed.mime);
    const destPath = dryRun
      ? targetPath
      : (await escribirAdjuntoEnDisco(DIRECTORIO_ADJUNTOS, {
          fileName: nombreSeguro(row.fileName),
          fileType: row.fileType,
          mimeType: parsed.mime,
          sha256,
          sizeBytes: parsed.bytes.length,
          bytes: parsed.bytes,
          origen: "data_url",
        })).storagePath;
    if (!dryRun) {
      await prismaClient.attachment.update({
        where: { id: row.id },
        data: {
          storagePath: destPath,
          sha256,
          sizeBytes: parsed.bytes.length,
          mimeType: parsed.mime,
          userId: row.message.chat.userId,
          fileUrl: null,
        },
      });
    }
    results.push({
      id: row.id,
      status: "migrado",
      storagePath: destPath,
      bytes: parsed.bytes.length,
    });
    migratedCount += 1;
    totalBytes += parsed.bytes.length;
  }

  const label = dryRun ? "[dry-run] " : "";
  console.log(`${label}Adjuntos candidatos: ${candidates.length}`);
  console.log(`${label}Migrados: ${migratedCount} · omitidos: ${skippedCount}`);
  console.log(`${label}Bytes que pasan a disco: ${totalBytes}`);
  console.log(`${label}Directorio: ${DIRECTORIO_ADJUNTOS}`);
  for (const result of results) {
    const suffix = result.storagePath
      ? ` -> ${result.storagePath} (${result.bytes} bytes)`
      : "";
    const reasonText = result.reason ? ` [${summarizeReason(result.reason)}]` : "";
    console.log(`  ${result.status} ${result.id}${suffix}${reasonText}`);
  }
  if (dryRun) {
    console.log("\nDry-run: no se ha escrito nada. Repite sin --dry-run para aplicar.");
  }
}

async function revertAttachments(): Promise<void> {
  const rows = await prismaClient.attachment.findMany({
    where: { storagePath: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  let revertedCount = 0;
  let missingFileCount = 0;
  for (const row of rows) {
    const storagePath = row.storagePath as string;
    const bytes = await leerAdjuntoDeDisco(DIRECTORIO_ADJUNTOS, storagePath);
    if (!bytes) {
      missingFileCount += 1;
      console.log(`  omitido ${row.id}: falta el archivo ${storagePath} (metadata conservada)`);
      continue;
    }
    const mime = row.mimeType ?? "application/octet-stream";
    await prismaClient.attachment.update({
      where: { id: row.id },
      data: {
        fileUrl: `data:${mime};base64,${bytes.toString("base64")}`,
        storagePath: null,
        sha256: null,
        sizeBytes: null,
        userId: null,
      },
    });
    revertedCount += 1;
  }
  console.log(`Adjuntos revertidos a data-URL: ${revertedCount} · sin archivo en disco: ${missingFileCount}`);
  console.log(
    "Para quitar además las columnas nuevas del esquema, sigue el README.reversion.md de",
  );
  console.log("prisma/migrations/20261005120100_attachment_disco_metadata/.");
  if (missingFileCount > 0) {
    console.log(
      `\nAviso: ${missingFileCount} fila(s) sin archivo en disco. Sus metadatos NO se han borrado,`,
    );
    console.log("así que la reversión de esquema sigue siendo segura, pero revisa esas filas.");
  }
}

async function main(): Promise<void> {
  const dryRun = hasFlag("--dry-run");
  const shouldRevert = hasFlag("--revert");
  if (dryRun && shouldRevert) {
    throw new Error("No se pueden combinar --dry-run y --revert: elige uno.");
  }
  if (shouldRevert) await revertAttachments();
  else await migrate(dryRun);
}

main().catch((error: unknown) => {
  console.error("[migrate-adjuntos] Error:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
