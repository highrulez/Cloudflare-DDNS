ALTER TABLE `CloudflareZone`
  ADD COLUMN `recordCount` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `lastSyncedAt` DATETIME(3) NULL;

ALTER TABLE `DdnsUpdateLog`
  MODIFY `action` ENUM(
    'CHECKED',
    'SKIPPED',
    'UPDATED',
    'CREATED',
    'FAILED',
    'DISABLED',
    'STOPPED_MANAGING',
    'DELETED',
    'NO_IP'
  ) NOT NULL;

ALTER TABLE `ManagedDnsRecord`
  DROP FOREIGN KEY `ManagedDnsRecord_zoneId_fkey`;

CREATE UNIQUE INDEX `CloudflareZone_id_accountId_key`
  ON `CloudflareZone`(`id`, `accountId`);

CREATE UNIQUE INDEX `ManagedDnsRecord_zoneId_cloudflareRecordId_key`
  ON `ManagedDnsRecord`(`zoneId`, `cloudflareRecordId`);

ALTER TABLE `ManagedDnsRecord`
  ADD CONSTRAINT `ManagedDnsRecord_zoneId_accountId_fkey`
  FOREIGN KEY (`zoneId`, `accountId`)
  REFERENCES `CloudflareZone`(`id`, `accountId`)
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
