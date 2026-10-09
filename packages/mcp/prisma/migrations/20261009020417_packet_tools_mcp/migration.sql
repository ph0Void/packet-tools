-- CreateTable
CREATE TABLE "DeviceProviderMcp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "typeDevice" TEXT NOT NULL DEFAULT 'GENERIC',
    "protocol" TEXT NOT NULL DEFAULT 'SIMULATION',
    "host" TEXT,
    "port" INTEGER,
    "serialPort" TEXT,
    "serialBaudrate" INTEGER DEFAULT 9600,
    "username" TEXT,
    "password" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OFFLINE',
    "isTemporary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VendorCacheMcp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "providerId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "prompt" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorCacheMcp_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "DeviceProviderMcp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SkillMcp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'agent',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PlanRecordMcp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "objective" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "totalSteps" INTEGER NOT NULL DEFAULT 0,
    "completedSteps" INTEGER NOT NULL DEFAULT 0,
    "failedSteps" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "DeviceProviderMcp_typeDevice_idx" ON "DeviceProviderMcp"("typeDevice");

-- CreateIndex
CREATE INDEX "DeviceProviderMcp_protocol_idx" ON "DeviceProviderMcp"("protocol");

-- CreateIndex
CREATE UNIQUE INDEX "VendorCacheMcp_providerId_key" ON "VendorCacheMcp"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "SkillMcp_slug_key" ON "SkillMcp"("slug");

-- CreateIndex
CREATE INDEX "SkillMcp_enabled_idx" ON "SkillMcp"("enabled");

-- CreateIndex
CREATE INDEX "PlanRecordMcp_status_idx" ON "PlanRecordMcp"("status");

-- CreateIndex
CREATE INDEX "PlanRecordMcp_createdAt_idx" ON "PlanRecordMcp"("createdAt");
