-- DropIndex
DROP INDEX "Attachment_userId_idx";

-- AlterTable
ALTER TABLE "Log" ADD COLUMN "chatId" TEXT;
ALTER TABLE "Log" ADD COLUMN "userId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Configuration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "systemPrompt" TEXT,
    "agentLogsEnabled" BOOLEAN NOT NULL DEFAULT true
);
INSERT INTO "new_Configuration" ("id", "systemPrompt") SELECT "id", "systemPrompt" FROM "Configuration";
DROP TABLE "Configuration";
ALTER TABLE "new_Configuration" RENAME TO "Configuration";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Log_createdAt_idx" ON "Log"("createdAt");

-- CreateIndex
CREATE INDEX "Log_level_idx" ON "Log"("level");

-- CreateIndex
CREATE INDEX "Log_userId_idx" ON "Log"("userId");

-- CreateIndex
CREATE INDEX "Log_chatId_idx" ON "Log"("chatId");
