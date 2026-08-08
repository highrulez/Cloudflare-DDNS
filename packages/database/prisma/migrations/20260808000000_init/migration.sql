CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(254) NOT NULL,
    `displayName` VARCHAR(100) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` ENUM('ADMIN') NOT NULL DEFAULT 'ADMIN',
    `mustChangePassword` BOOLEAN NOT NULL DEFAULT true,
    `sessionVersion` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProviderConnection` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `providerKey` VARCHAR(32) NOT NULL,
    `label` VARCHAR(80) NOT NULL,
    `status` ENUM('PENDING', 'CONNECTING', 'ACTIVE', 'DEGRADED', 'FAILED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
    `statusMessage` VARCHAR(500) NULL,
    `lastCheckedAt` DATETIME(3) NULL,
    `lastSyncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `ProviderConnection_userId_status_idx`(`userId`, `status`),
    UNIQUE INDEX `ProviderConnection_userId_providerKey_label_key`(`userId`, `providerKey`, `label`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProviderCredential` (
    `id` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `status` ENUM('STAGED', 'ACTIVE', 'REVOKED') NOT NULL DEFAULT 'STAGED',
    `ciphertext` TEXT NOT NULL,
    `iv` VARCHAR(64) NOT NULL,
    `authTag` VARCHAR(64) NOT NULL,
    `keyVersion` INTEGER NOT NULL DEFAULT 1,
    `maskedHint` VARCHAR(16) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `ProviderCredential_connectionId_status_idx`(`connectionId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProviderAccount` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isSynthetic` BOOLEAN NOT NULL DEFAULT false,
    `staleAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `ProviderAccount_userId_name_idx`(`userId`, `name`),
    UNIQUE INDEX `ProviderAccount_connectionId_externalId_key`(`connectionId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DnsZone` (
    `id` VARCHAR(191) NOT NULL,
    `accountId` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(253) NOT NULL,
    `status` VARCHAR(32) NULL,
    `nameservers` TEXT NULL,
    `staleAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `DnsZone_name_idx`(`name`),
    UNIQUE INDEX `DnsZone_accountId_externalId_key`(`accountId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DnsRecord` (
    `id` VARCHAR(191) NOT NULL,
    `zoneId` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `type` VARCHAR(16) NOT NULL,
    `name` VARCHAR(253) NOT NULL,
    `content` TEXT NOT NULL,
    `ttl` INTEGER NOT NULL,
    `proxied` BOOLEAN NULL,
    `priority` INTEGER NULL,
    `staleAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    INDEX `DnsRecord_name_type_idx`(`name`, `type`),
    UNIQUE INDEX `DnsRecord_zoneId_externalId_key`(`zoneId`, `externalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DdnsSelection` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `recordId` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `DdnsSelection_recordId_key`(`recordId`),
    INDEX `DdnsSelection_userId_enabled_idx`(`userId`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SyncRun` (
    `id` VARCHAR(191) NOT NULL,
    `connectionId` VARCHAR(191) NOT NULL,
    `jobId` VARCHAR(191) NULL,
    `status` ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'QUEUED',
    `accountsFound` INTEGER NOT NULL DEFAULT 0,
    `zonesFound` INTEGER NOT NULL DEFAULT 0,
    `recordsFound` INTEGER NOT NULL DEFAULT 0,
    `errorMessage` TEXT NULL,
    `startedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `SyncRun_connectionId_createdAt_idx`(`connectionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IpObservation` (
    `id` VARCHAR(191) NOT NULL,
    `address` VARCHAR(45) NOT NULL,
    `family` INTEGER NOT NULL,
    `source` VARCHAR(64) NOT NULL,
    `changed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `IpObservation_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppSetting` (
    `key` VARCHAR(100) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(80) NOT NULL,
    `entityType` VARCHAR(80) NULL,
    `entityId` VARCHAR(191) NULL,
    `message` VARCHAR(500) NOT NULL,
    `metadata` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `AuditEvent_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `AuditEvent_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProviderConnection` ADD CONSTRAINT `ProviderConnection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProviderCredential` ADD CONSTRAINT `ProviderCredential_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `ProviderConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProviderAccount` ADD CONSTRAINT `ProviderAccount_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProviderAccount` ADD CONSTRAINT `ProviderAccount_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `ProviderConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DnsZone` ADD CONSTRAINT `DnsZone_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `ProviderAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DnsRecord` ADD CONSTRAINT `DnsRecord_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `DnsZone`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DdnsSelection` ADD CONSTRAINT `DdnsSelection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DdnsSelection` ADD CONSTRAINT `DdnsSelection_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `DnsRecord`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `SyncRun` ADD CONSTRAINT `SyncRun_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `ProviderConnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
