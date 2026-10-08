# Reversión (down) de `20261005120100_attachment_disco_metadata`

Aplica también a `20261005120000_indices_chat_message_attachment` (la que va justo
antes y comparte el mismo procedimiento de reversión).

Prisma no genera migraciones `down` ni tiene un comando para "desaplicar" una
migración **exitosa** (`migrate resolve --rolled-back` solo acepta migraciones en
estado *failed*: devuelve `P3012`). La reversión son, por tanto, pasos explícitos, y
todos se han probado sobre una **copia** de la base de datos de desarrollo (43 chats,
102 mensajes, 192 usuarios, sin pérdida de datos).

El orden importa: primero el **contenido** (`--revert` del script), después el
**esquema**. Al revés, la columna `fileUrl` ya no existe y el contenido se pierde.

## 0. Antes de nada: copia de seguridad

```bash
cp .packet_tool_database.db .packet_tool_database.db.bak
```

## 1. Devolver el contenido de los adjuntos a la columna `fileUrl`

```bash
npx tsx scripts/migrate-adjuntos.ts --revert
```

Qué hace, por cada `Attachment` con `storagePath`:

- lee el archivo de `ATTACHMENTS_DIR`,
- reconstruye `fileUrl = data:<mime>;base64,<contenido>`,
- pone `storagePath`, `sha256`, `sizeBytes` y `userId` a `NULL`.

Es **idempotente** (solo mira filas con `storagePath` no nulo) y **no destructivo**
con los fallos: si el archivo no está en disco, avisa y **conserva** la fila tal
como está, porque quedarse sin metadata sería peor que quedarse con ella. Repón el
archivo desde el backup y repite.

Los archivos de disco **no** se borran: son inocuos sin fila que los referencie
(`GET /api/chats/attachments/:id` valida ownership y la ruta). Si quieres limpiar el
espacio, bórralos a mano después de comprobar que la base ya no los referencia:

```sql
-- Aviso: NO hay `storagePath` para leer; se listan los archivos de ATTACHMENTS_DIR
-- y se borran a mano los que no correspondan a ninguna fila.
```

## 2. SQL inverso del esquema

### 2.1 Índices (V26a) — `DROP INDEX`

```sql
DROP INDEX IF EXISTS "Attachment_userId_idx";
DROP INDEX IF EXISTS "Attachment_messageId_idx";
DROP INDEX IF EXISTS "Message_chatId_idx";
DROP INDEX IF EXISTS "Chat_userId_idx";
```

`DROP INDEX` no toca datos: es la operación más barata de la reversión.

### 2.2 Columnas de `Attachment` (V26c) — `RedefineTables` inverso

SQLite no permite quitar columnas con `ALTER TABLE ... DROP COLUMN` si están
indexadas, y además esta migración **recreó la tabla** (`RedefineTables`), así que
la reversión correcta es simétrica: volver a recrearla sin las columnas nuevas.

```sql
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Attachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL DEFAULT 'IMAGE',
    "fileUrl" TEXT,
    "mimeType" TEXT,
    "messageId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Attachment" ("createdAt", "fileName", "fileType", "fileUrl", "id", "messageId", "mimeType")
  SELECT "createdAt", "fileName", "fileType", "fileUrl", "id", "messageId", "mimeType" FROM "Attachment";
DROP TABLE "Attachment";
ALTER TABLE "new_Attachment" RENAME TO "Attachment";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
```

La copia es 1:1: se conservan todas las filas y sus `fileUrl`. Si en este punto
alguna fila tiene `fileUrl IS NULL` (un adjunto ya escrito por el endpoint nuevo, que
nunca tuvo data-URL), su contenido **no** se puede recuperar de la base: repón el
archivo desde `ATTACHMENTS_DIR` y vuelve a insertar el `fileUrl` a mano antes de
continuar, o acepta que ese adjunto se pierde.

## 3. Quitar las filas del historial de migraciones

```sql
DELETE FROM _prisma_migrations
 WHERE migration_name IN (
   '20261005120000_indices_chat_message_attachment',
   '20261005120100_attachment_disco_metadata'
 );
```

Sin esto, `prisma migrate status`/`migrate dev` avisarían de una migración aplicada
que no está en el disco, y `migrate dev` pediría resolverla (en el revert también
desaparece la carpeta `prisma/migrations/2026100512*`).

## 4. Revertir el código y regenerar el cliente

```bash
git revert <commit de la migración>   # o borrar las carpetas + schema.prisma
npm run generate                      # el cliente vuelve a no conocer los campos
```

`docker-entrypoint.sh` y `src/desktop/Bootstrap.ts` recorren `prisma/migrations`: al
desaparecer las carpetas, ni un contenedor ni un instalador ya arrancado
reintroducen las columnas ni los índices.

## Comprobado

Sobre una **copia** de `.packet_tool_database.db` (43 chats, 102 mensajes, 192
usuarios):

| Paso | Resultado |
| --- | --- |
| Copia antes de aplicar | 43 / 102 / 192, 10 migraciones registradas, `Attachment` sin columnas nuevas |
| Tras `migrate deploy` de las 2 migraciones | 43 / 102 / 192, 12 migraciones, columnas `storagePath`/`sha256`/`sizeBytes`/`userId` presentes, índices `Chat_userId_idx`, `Message_chatId_idx`, `Attachment_messageId_idx`, `Attachment_userId_idx` presentes, `PRAGMA foreign_key_check` sin violaciones |
| Tras el revert (pasos 1-3) | 43 / 102 / 192, `Attachment` con sus 7 columnas originales, sin los 4 índices, `foreign_key_check` vacío, 10 migraciones registradas |

Cifras de filas idénticas antes, después y tras revertir: la migración y su reversión
no pierden ni duplican datos.

## Nota sobre `Attachment_messageId_idx`

La migración `20261005120000` crea ese índice y `20261005120100` **recrea la tabla**
`Attachment`, lo que se lleva el índice con el `DROP TABLE`. Por eso `20261005120100`
lo vuelve a crear con `CREATE INDEX IF NOT EXISTS` al final. Si alguien edita estas
migraciones, que no se le olvide esa línea: sin ella la tabla se queda sin índice de
`messageId` y nadie lo nota hasta que el historial del chat empieza a escanear.