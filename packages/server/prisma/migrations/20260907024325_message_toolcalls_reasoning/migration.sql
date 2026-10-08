-- AlterTable
ALTER TABLE "Message" ADD COLUMN "reasoning" TEXT;
ALTER TABLE "Message" ADD COLUMN "toolCalls" JSONB;
