-- Prompt caching (2026-10-10): tokens leídos y escritos en el caché, por mensaje del assistant.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "cacheReadTokens" INTEGER,
ADD COLUMN     "cacheWriteTokens" INTEGER;
