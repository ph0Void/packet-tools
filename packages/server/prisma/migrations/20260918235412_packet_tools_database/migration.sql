-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CronJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prompt" TEXT,
    "cronExpression" TEXT,
    "actionType" TEXT NOT NULL DEFAULT 'STANDARD',
    "scheduledAt" DATETIME,
    "payload" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRun" DATETIME,
    "nextRun" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT,
    "topologyId" TEXT,
    "deviceProviderId" TEXT,
    CONSTRAINT "CronJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CronJob_topologyId_fkey" FOREIGN KEY ("topologyId") REFERENCES "Topology" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CronJob_deviceProviderId_fkey" FOREIGN KEY ("deviceProviderId") REFERENCES "DeviceProviders" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CronJob" ("actionType", "createdAt", "cronExpression", "description", "deviceProviderId", "id", "isActive", "lastRun", "name", "nextRun", "payload", "prompt", "status", "topologyId", "updatedAt", "userId") SELECT "actionType", "createdAt", "cronExpression", "description", "deviceProviderId", "id", "isActive", "lastRun", "name", "nextRun", "payload", "prompt", "status", "topologyId", "updatedAt", "userId" FROM "CronJob";
DROP TABLE "CronJob";
ALTER TABLE "new_CronJob" RENAME TO "CronJob";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
