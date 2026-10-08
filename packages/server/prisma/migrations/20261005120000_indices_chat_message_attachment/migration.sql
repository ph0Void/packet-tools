-- V26a — Índices de persistencia del chat.
--
-- Sin ellos, las tres consultas más calientes de la tabla son escaneos completos:
--   * `GET /api/chats` filtra por `Chat.userId` y ordena por `updatedAt DESC`
--     (sidebar, en cada carga y en cada refresco);
--   * el historial de un chat (`GET /api/chats/:id/messages`) y el `findMany` del
--     contexto del turno filtran por `Message.chatId`;
--   * `include: { attachments }` al listar mensajes y el borrado en cascada de un
--     chat recorren `Attachment.messageId`.
--
-- `CREATE INDEX` no reescribe la tabla: en SQLite es la misma construcción que usa
-- Prisma para los `@@index`, y es reversible con `DROP INDEX` (ver README.reversion.md).
--
-- Nota sobre `Message.chatId`: `Message_chatId_clientMessageId_key` (el único de
-- `clientMessageId`) ya lleva `chatId` como prefijo y SQLite puede usarlo para esta
-- búsqueda. El índice explícito se añade igualmente para que el historial no dependa
-- de la forma de ese único y para que el plan de la paginación por `createdAt` tenga
-- un índice dedicado.

-- CreateIndex
CREATE INDEX "Chat_userId_idx" ON "Chat"("userId");

-- CreateIndex
CREATE INDEX "Message_chatId_idx" ON "Message"("chatId");

-- CreateIndex
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");