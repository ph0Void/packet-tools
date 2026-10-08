# Reversión (down) de `20261006232913_logs_agente_usuario_chat`

Añade a `Log` las columnas `userId` y `chatId` ( Ownership de los registros: el
listado de `/dashboard/log` deja de ser global y pasa a ser "los míos, o todos si
soy ADMIN") y a `Configuration` el interruptor `agentLogsEnabled` (traza del agente
agéntico). También crea cuatro índices en `Log`.

Prisma no genera migraciones `down`: la reversión es manual y la secuencia importa,
porque **esta migración recrea la tabla `Configuration`** (ver §3).

## 1. SQL inverso

```sql
DROP INDEX IF EXISTS "Log_chatId_idx";
DROP INDEX IF EXISTS "Log_userId_idx";
DROP INDEX IF EXISTS "Log_level_idx";
DROP INDEX IF EXISTS "Log_createdAt_idx";
```

Las columnas se pueden dejar: `userId`/`chatId` son NULLABLE y toda consulta
antigua (`SELECT level, title, content FROM "Log"`) sigue funcionando. Si aun así
se quieren quitar (SQLite 3.35+), **no** uses `ALTER TABLE ... DROP COLUMN`
directamente sobre `Log` si más adelante se revierte `20261006232945_attachment_userid_idx`
— el orden inverso recomendado es:

```sql
-- Sólo si además se revierte la migración del índice de Attachment:
-- recrear Log copia a tabla nueva porque SQLite no admite DROP COLUMN en tablas
-- con índices/FK de forma fiable. Ver el README de esa migración.
```

En la práctica **no reviertas las columnas**: quitarlas no aporta nada y obliga a
regenerar el cliente y a tocar los tres routers que las leen.

## 2. Quitar la fila del historial de migraciones

```sql
DELETE FROM _prisma_migrations WHERE migration_name = '20261006232913_logs_agente_usuario_chat';
DELETE FROM _prisma_migrations WHERE migration_name = '20261006232945_attachment_userid_idx';
```

Sin esto `prisma migrate status`/`migrate dev` avisarían de una migración aplicada
que no está en el disco (en el revert también desaparecen las carpetas).

## 3. Por qué se recrea `Configuration`

`ModelProvider.configurationId` es una **FK** que apunta a `Configuration`. SQLite no
puede añadir una columna con `ALTER TABLE ... ADD COLUMN` a una tabla referenciada
sin rehacerla, así que Prisma emite `RedefineTables`:

1. `PRAGMA defer_foreign_keys=ON` — dentro de una transacción, `PRAGMA
   foreign_keys=OFF` es un no-op; esto es lo que permite el `DROP TABLE` con la FK
   de `ModelProvider` apuntando a la tabla.
2. `CREATE TABLE "new_Configuration"` con `agentLogsEnabled BOOLEAN NOT NULL DEFAULT true`.
3. `INSERT ... SELECT "id","systemPrompt" FROM "Configuration"` — **los datos se
   copian**; solo se pierde el valor del interruptor si venías de una versión
   anterior (y entonces se queda en `true`, que es el default).
4. `DROP TABLE` + `ALTER TABLE ... RENAME TO "Configuration"` — el nombre se
   restaura, así que la definición de la FK en `ModelProvider` sigue apuntando a la
   tabla correcta.

Es el mismo patrón que ya usaron `20260926004411` (Log) y
`20261005120100_attachment_disco_metadata` (Attachment) en este repositorio.

## 4. Revertir el código y regenerar el cliente

```bash
git revert <commit de la migración>   # o borrar las carpetas + schema.prisma
npm run generate
```

`docker-entrypoint.sh` y `src/desktop/Bootstrap.ts` recorren `prisma/migrations`: al
desaparecer las carpetas, ni un contenedor ni un instalador ya arrancado recrean los
índices ni las columnas.

## 5. La segunda migración (`20261006232945_attachment_userid_idx`)

Esta migración **restaura** `Attachment_userId_idx`, que `202609...` había creado a
mano y que `schema.prisma` nunca declaró (deriva esquema↔BD). Al añadir
`@@index([userId])` al modelo `Attachment`, la migración de los logs lo dropeó por
estar "de más" en la base, y esta lo vuelve a crear. Si se revierte en orden
inverso (esta primero) el índice sobrevive; si se revierte solo la de los logs, hay
que ejecutar a mano el `CREATE INDEX` de esta migración.

## Comprobado

Sobre una **copia** de `.packet_tool_database.db`: `Configuration` conserva su fila
y su `systemPrompt` tras la recreación (0 filas perdidas), `PRAGMA
foreign_key_check` queda vacío, los cuatro índices de `Log` existen y la consulta
`SELECT * FROM "Log" ORDER BY createdAt DESC LIMIT 20` sigue funcionando.