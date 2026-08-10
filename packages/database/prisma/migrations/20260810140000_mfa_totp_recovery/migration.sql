-- AlterTable
ALTER TABLE `User` ADD COLUMN `mfaEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `mfaSecretCiphertext` LONGBLOB NULL,
    ADD COLUMN `mfaSecretIv` LONGBLOB NULL,
    ADD COLUMN `mfaSecretAuthTag` LONGBLOB NULL,
    ADD COLUMN `mfaSecretKeyVersion` INTEGER NULL,
    ADD COLUMN `mfaEnabledAt` DATETIME(3) NULL,
    ADD COLUMN `mfaLastUsedStep` BIGINT NULL;

-- AlterTable
ALTER TABLE `Session` ADD COLUMN `stronglyAuthenticatedUntil` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `AuthAuditEvent` MODIFY `type` ENUM('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_RATE_LIMITED', 'TURNSTILE_FAILED', 'LOGOUT', 'SESSION_EXPIRED', 'MFA_ENROLLMENT_STARTED', 'MFA_ENABLED', 'MFA_CHALLENGE_FAILED', 'MFA_LOGIN_SUCCESS', 'MFA_RECOVERY_CODE_USED', 'MFA_RECOVERY_CODES_REGENERATED', 'MFA_DISABLED') NOT NULL;

-- CreateTable
CREATE TABLE `MfaRecoveryCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` CHAR(64) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MfaRecoveryCode_userId_idx`(`userId`),
    INDEX `MfaRecoveryCode_userId_usedAt_idx`(`userId`, `usedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MfaChallenge` (
    `id` VARCHAR(191) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `failedAttempts` INTEGER NOT NULL DEFAULT 0,
    `consumedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MfaChallenge_tokenHash_key`(`tokenHash`),
    INDEX `MfaChallenge_userId_idx`(`userId`),
    INDEX `MfaChallenge_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MfaEnrollment` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `secretCiphertext` LONGBLOB NOT NULL,
    `secretIv` LONGBLOB NOT NULL,
    `secretAuthTag` LONGBLOB NOT NULL,
    `secretKeyVersion` INTEGER NOT NULL DEFAULT 1,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MfaEnrollment_userId_key`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MfaRecoveryCode` ADD CONSTRAINT `MfaRecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MfaChallenge` ADD CONSTRAINT `MfaChallenge_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MfaEnrollment` ADD CONSTRAINT `MfaEnrollment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
