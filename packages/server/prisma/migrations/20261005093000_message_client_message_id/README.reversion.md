# Reversión (down) de `20261005093000_message_client_message_id`

Prisma no genera migraciones `down` ni tiene un comando para "desaplicar" una
migración **exitosa** (`migrate resolve --rolled-back` solo acepta migraciones en
estado *failed*: devuelve `P3012`). La reversión son, por tanto, tres pasos
explícitos, y todos se han probado sobre una **copia** de la base de datos de
desarrollo (60+ mensajes reales, sin pérdida de datos):

### 1. SQL inverso sobre la base de datos

```sql
DROP INDEX IF EXISTS "Message_chatId_clientMessageId_key";
ALTER TABLE "Message" DROP COLUMN "clientMessageId";
```

El orden importa: no se puede borrar una columna que forma parte de un índice.
`ALTER TABLE ... DROP COLUMN` exige SQLite ≥ 3.35 (el `better-sqlite3` v12 del
proyecto va sobrado); para una base más antigua, la alternativa es recrear la
tabla sin la columna, con el patrón `RedefineTables` que ya usa
`20260918213741_device_providers_temporary`.

### 2. Quitar la fila del historial de migraciones

```sql
DELETE FROM _prisma_migrations WHERE migration_name = '20261005093000_message_client_message_id';
```

Sin esto, `prisma migrate status`/`migrate dev` avisarían de una migración
aplicada que no está en el disco (y `migrate dev` pediría resolverla), porque en
el revert también desaparece la carpeta `prisma/migrations/20261005093000_...`.
Con la fila fuera, `migrate status` vuelve a decir *up to date* (verificado).

### 3. Revertir el código y regenerar el cliente

```bash
git revert <commit de la migración>   # o borrar la carpeta + schema.prisma
npm run generate                      # el cliente vuelve a no conocer el campo
```

`docker-entrypoint.sh` y `src/desktop/Bootstrap.ts` recorren
`prisma/migrations`: al desaparecer la carpeta, ninguno intenta reaplicarla, así
que un contenedor o un instalador ya arrancado no reintroducen la columna.

### Comprobado

Sobre una copia de `.packet_tool_database.db`: antes → columna e índice presentes
y 63 mensajes; después de aplicar (1) y (2) → columna e índice ausentes, 63
mensajes, `PRAGMA foreign_key_check` sin violaciones y `prisma migrate status`
*up to date* con 9 migraciones.
