# Reversión (down) de `20261005120000_indices_chat_message_attachment`

Prisma no genera migraciones `down` ni tiene un comando para "desaplicar" una
migración **exitosa** (`migrate resolve --rolled-back` solo acepta migraciones en
estado *failed*: devuelve `P3012`). Aquí la reversión es trivial porque la migración
solo crea índices: `DROP INDEX` no toca datos.

## 1. SQL inverso

```sql
DROP INDEX IF EXISTS "Chat_userId_idx";
DROP INDEX IF EXISTS "Message_chatId_idx";
DROP INDEX IF EXISTS "Attachment_messageId_idx";
```

(Si también se revierte `20261005120100_attachment_disco_metadata`, añade
`DROP INDEX IF EXISTS "Attachment_userId_idx";` — ver el README de esa migración,
que documenta el procedimiento completo y combinado.)

## 2. Quitar la fila del historial de migraciones

```sql
DELETE FROM _prisma_migrations WHERE migration_name = '20261005120000_indices_chat_message_attachment';
```

Sin esto, `prisma migrate status`/`migrate dev` avisarían de una migración aplicada
que no está en el disco (en el revert también desaparece la carpeta
`prisma/migrations/20261005120000_...`).

## 3. Revertir el código y regenerar el cliente

```bash
git revert <commit de la migración>   # o borrar la carpeta + schema.prisma
npm run generate
```

`docker-entrypoint.sh` y `src/desktop/Bootstrap.ts` recorren `prisma/migrations`: al
desaparecer la carpeta, ni un contenedor ni un instalador ya arrancado recrean los
índices.

## Comprobado

Sobre una **copia** de `.packet_tool_database.db` (43 chats, 102 mensajes, 192
usuarios): antes de aplicar no existían `Chat_userId_idx`, `Message_chatId_idx` ni
`Attachment_messageId_idx`; tras aplicar están los tres y las filas siguen siendo
43/102/192 con `PRAGMA foreign_key_check` vacío; tras el `DROP INDEX` vuelven a no
existir y las filas no cambian. Cero pérdida de datos.

## Nota

`Message_chatId_idx` es, técnicamente, redundante con
`Message_chatId_clientMessageId_key` (el `@@unique([chatId, clientMessageId])` de Q5
lleva `chatId` como prefijo y SQLite lo puede recorrer). Se crea igualmente para que
el historial y su borrado en cascada no dependan de la forma de ese único: si en el
futuro la clave de idempotencia cambia, el índice del historial sigue ahí.