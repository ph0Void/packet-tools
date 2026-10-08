-- V26c — Metadata de adjuntos en disco (D6).
--
-- El contenido de los adjuntos pasa a `ATTACHMENTS_DIR`; aquí solo queda la
-- metadata. Las cuatro columnas son NULLABLE para que las filas anteriores (con la
-- data-URL en `Attachment.fileUrl`) sigan siendo válidas y `scripts/migrar-adjuntos.ts`
-- pueda rellenarlas después (con `--dry-run` antes). `fileUrl` **no** se borra: queda
-- en `NULL` en lo nuevo, se conserva la columna para lo aún no migrado y para poder
-- revertir.
--
-- `userId` es el ownership que autoriza `GET /api/chats/attachments/:id` (junto con
-- ser ADMIN o dueño del chat). NULL en las filas antiguas: entonces manda el chat.
--
-- ## Por qué `RedefineTables` y no `ALTER TABLE ADD COLUMN`
--
-- SQLite **no** permite añadir una restricción `FOREIGN KEY` a una columna con
-- `ALTER TABLE ... ADD COLUMN` (solo acepta `REFERENCES` si la columna nueva trae ya
-- un valor por defecto no nulo, y sin tabla nueva la clave foránea tampoco se crea).
-- Prisma resuelve exactamente esto con el patrón `RedefineTables` —crear tabla
-- nueva, copiar, borrar la vieja, renombrar— que ya usan las migraciones
-- `20260918213741_device_providers_temporary` y `20260926004411_packet_tools_database`
-- de este repo. Se sigue aquí el mismo patrón (y no un `CREATE TRIGGER ... FOREIGN
-- KEY`, que SQLite no entiende).
--
-- La copia es 1:1: se conservan todas las filas, incluidas las que tienen la data-URL
-- en `fileUrl`, y se fija el nuevo `userId` a NULL (las antiguas no lo tienen; la
-- migración de adjuntos lo rellena con el dueño de su chat).

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT 'IMAGE',
    "fileUrl" TEXT,
    "mimeType" TEXT,
    "storagePath" TEXT,
    "sha256" TEXT,
    "sizeBytes" INTEGER,
    "userId" TEXT,
    "messageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("createdAt", "fileName", "fileType", "fileUrl", "id", "messageId", "mimeType") SELECT "createdAt", "fileName", "fileType", "fileUrl", "id", "messageId", "mimeType" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Attachment_userId_idx" ON "Attachment"("userId");

-- CreateIndex (V26a, recreado)
--
-- `Attachment_messageId_idx` lo crea la migración `20261005120000`, pero el
-- `DROP TABLE "Attachment"` de arriba se lleva **todos** sus índices con él: sin
-- recrearlo aquí, la tabla se quedaría sin el índice de `messageId` y nadie lo
-- notaría hasta que una consulta del historial empezara a escanear. Por eso se
-- repite (es idempotente solo si el índice no existe: `IF NOT EXISTS` lo deja
-- como estaba si ya estuviera).
CREATE INDEX IF NOT EXISTS "Attachment_messageId_idx" ON "Attachment"("messageId");