-- CreateTable
CREATE TABLE `AuthAuditEvent` (
    `id` VARCHAR(191) NOT NULL,
    `type` ENUM('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGIN_RATE_LIMITED', 'TURNSTILE_FAILED', 'LOGOUT', 'SESSION_EXPIRED') NOT NULL,
    `success` BOOLEAN NOT NULL,
    `sourceIp` VARCHAR(64) NULL,
    `userAgent` VARCHAR(512) NULL,
    `username` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuthAuditEvent_createdAt_idx`(`createdAt`),
    INDEX `AuthAuditEvent_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
