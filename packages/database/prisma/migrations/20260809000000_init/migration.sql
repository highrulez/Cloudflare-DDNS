CREATE TABLE `User` (
  `id` VARCHAR(191) NOT NULL,
  `username` VARCHAR(191) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `User_username_key`(`username`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Session` (
  `id` VARCHAR(191) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `Session_tokenHash_key`(`tokenHash`),
  INDEX `Session_userId_idx`(`userId`),
  INDEX `Session_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SetupState` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `step` INTEGER NOT NULL DEFAULT 1,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CloudflareAccount` (
  `id` VARCHAR(191) NOT NULL,
  `name` VARCHAR(191) NOT NULL,
  `tokenCiphertext` LONGBLOB NOT NULL,
  `tokenIv` LONGBLOB NOT NULL,
  `tokenAuthTag` LONGBLOB NOT NULL,
  `tokenKeyVersion` INTEGER NOT NULL DEFAULT 1,
  `tokenHint` VARCHAR(32) NOT NULL,
  `verifiedAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CloudflareAccount_name_key`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CloudflareZone` (
  `id` VARCHAR(191) NOT NULL,
  `accountId` VARCHAR(191) NOT NULL,
  `cloudflareId` VARCHAR(64) NOT NULL,
  `name` VARCHAR(253) NOT NULL,
  `status` VARCHAR(32) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `CloudflareZone_accountId_cloudflareId_key`(`accountId`, `cloudflareId`),
  INDEX `CloudflareZone_name_idx`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ManagedDnsRecord` (
  `id` VARCHAR(191) NOT NULL,
  `accountId` VARCHAR(191) NOT NULL,
  `zoneId` VARCHAR(191) NOT NULL,
  `cloudflareRecordId` VARCHAR(64) NULL,
  `type` ENUM('A', 'AAAA') NOT NULL,
  `hostname` VARCHAR(253) NOT NULL,
  `normalizedHostname` VARCHAR(253) NOT NULL,
  `content` VARCHAR(45) NULL,
  `proxied` BOOLEAN NOT NULL DEFAULT false,
  `ttl` INTEGER NOT NULL DEFAULT 1,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `automatic` BOOLEAN NOT NULL DEFAULT true,
  `health` ENUM('UNKNOWN', 'HEALTHY', 'DRIFTED', 'ERROR', 'DISABLED') NOT NULL DEFAULT 'UNKNOWN',
  `lastCheckedAt` DATETIME(3) NULL,
  `lastUpdatedAt` DATETIME(3) NULL,
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ManagedDnsRecord_accountId_zoneId_normalizedHostname_type_key`(`accountId`, `zoneId`, `normalizedHostname`, `type`),
  INDEX `ManagedDnsRecord_enabled_type_idx`(`enabled`, `type`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `AppSettings` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `intervalMinutes` INTEGER NOT NULL DEFAULT 5,
  `ipv4Enabled` BOOLEAN NOT NULL DEFAULT true,
  `ipv6Enabled` BOOLEAN NOT NULL DEFAULT false,
  `automaticUpdates` BOOLEAN NOT NULL DEFAULT true,
  `providerPolicy` VARCHAR(32) NOT NULL DEFAULT 'ordered',
  `ipv4Providers` JSON NULL,
  `ipv6Providers` JSON NULL,
  `requestTimeoutMs` INTEGER NOT NULL DEFAULT 5000,
  `retentionDays` INTEGER NOT NULL DEFAULT 90,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DdnsRun` (
  `id` VARCHAR(191) NOT NULL,
  `trigger` ENUM('SCHEDULED', 'MANUAL_CHECK', 'MANUAL_UPDATE', 'FORCE', 'SETUP') NOT NULL,
  `status` ENUM('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'RUNNING',
  `force` BOOLEAN NOT NULL DEFAULT false,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `recordsTotal` INTEGER NOT NULL DEFAULT 0,
  `recordsUpdated` INTEGER NOT NULL DEFAULT 0,
  `recordsFailed` INTEGER NOT NULL DEFAULT 0,
  `summary` TEXT NULL,
  INDEX `DdnsRun_startedAt_idx`(`startedAt`),
  INDEX `DdnsRun_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IpDetectionRun` (
  `id` VARCHAR(191) NOT NULL,
  `ddnsRunId` VARCHAR(191) NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `finishedAt` DATETIME(3) NULL,
  `ipv4` VARCHAR(45) NULL,
  `ipv6` VARCHAR(45) NULL,
  `success` BOOLEAN NOT NULL DEFAULT false,
  INDEX `IpDetectionRun_startedAt_idx`(`startedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `IpDetectionResult` (
  `id` VARCHAR(191) NOT NULL,
  `runId` VARCHAR(191) NOT NULL,
  `family` ENUM('IPV4', 'IPV6') NOT NULL,
  `provider` VARCHAR(255) NOT NULL,
  `success` BOOLEAN NOT NULL,
  `address` VARCHAR(45) NULL,
  `error` TEXT NULL,
  `durationMs` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `IpDetectionResult_runId_family_idx`(`runId`, `family`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `DdnsUpdateLog` (
  `id` VARCHAR(191) NOT NULL,
  `runId` VARCHAR(191) NOT NULL,
  `recordId` VARCHAR(191) NULL,
  `hostname` VARCHAR(253) NOT NULL,
  `type` ENUM('A', 'AAAA') NOT NULL,
  `previousIp` VARCHAR(45) NULL,
  `newIp` VARCHAR(45) NULL,
  `action` ENUM('CHECKED', 'SKIPPED', 'UPDATED', 'CREATED', 'FAILED', 'DISABLED', 'NO_IP') NOT NULL,
  `result` ENUM('SUCCESS', 'ERROR', 'UNCHANGED') NOT NULL,
  `providerRequestId` VARCHAR(128) NULL,
  `providerResponse` TEXT NULL,
  `error` TEXT NULL,
  `durationMs` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `DdnsUpdateLog_runId_idx`(`runId`),
  INDEX `DdnsUpdateLog_recordId_createdAt_idx`(`recordId`, `createdAt`),
  INDEX `DdnsUpdateLog_result_createdAt_idx`(`result`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SchedulerLease` (
  `name` VARCHAR(64) NOT NULL,
  `ownerId` VARCHAR(128) NOT NULL,
  `leaseExpiresAt` DATETIME(3) NOT NULL,
  `heartbeatAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `SchedulerState` (
  `id` INTEGER NOT NULL DEFAULT 1,
  `ownerId` VARCHAR(128) NULL,
  `running` BOOLEAN NOT NULL DEFAULT false,
  `lastCheckAt` DATETIME(3) NULL,
  `nextCheckAt` DATETIME(3) NULL,
  `lastRunId` VARCHAR(191) NULL,
  `lastError` TEXT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `CloudflareZone` ADD CONSTRAINT `CloudflareZone_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `CloudflareAccount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ManagedDnsRecord` ADD CONSTRAINT `ManagedDnsRecord_accountId_fkey` FOREIGN KEY (`accountId`) REFERENCES `CloudflareAccount`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ManagedDnsRecord` ADD CONSTRAINT `ManagedDnsRecord_zoneId_fkey` FOREIGN KEY (`zoneId`) REFERENCES `CloudflareZone`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `IpDetectionRun` ADD CONSTRAINT `IpDetectionRun_ddnsRunId_fkey` FOREIGN KEY (`ddnsRunId`) REFERENCES `DdnsRun`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `IpDetectionResult` ADD CONSTRAINT `IpDetectionResult_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `IpDetectionRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DdnsUpdateLog` ADD CONSTRAINT `DdnsUpdateLog_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `DdnsRun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `DdnsUpdateLog` ADD CONSTRAINT `DdnsUpdateLog_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `ManagedDnsRecord`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
