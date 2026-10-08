-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DeviceProviders" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "typeDevice" TEXT NOT NULL DEFAULT 'PACKET_TRACER',
    "protocol" TEXT NOT NULL DEFAULT 'SIMULATION',
    "host" TEXT DEFAULT 'http://localhost:7531',
    "port" INTEGER,
    "serialPort" TEXT,
    "serialBaudrate" INTEGER,
    "username" TEXT,
    "password" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "isTemporary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "topologyId" TEXT,
    CONSTRAINT "DeviceProviders_topologyId_fkey" FOREIGN KEY ("topologyId") REFERENCES "Topology" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_DeviceProviders" ("createdAt", "host", "id", "name", "password", "port", "protocol", "serialBaudrate", "serialPort", "status", "topologyId", "typeDevice", "updatedAt", "username") SELECT "createdAt", "host", "id", "name", "password", "port", "protocol", "serialBaudrate", "serialPort", "status", "topologyId", "typeDevice", "updatedAt", "username" FROM "DeviceProviders";
DROP TABLE "DeviceProviders";
ALTER TABLE "new_DeviceProviders" RENAME TO "DeviceProviders";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
