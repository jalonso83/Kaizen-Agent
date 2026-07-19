-- ─────────────────────────────────────────────────────────────────────────
-- Kaizen · BD LOCAL en MySQL 8 (alternativa de desarrollo).
--
-- ⚠️ LEE ESTO ANTES DE USARLO:
-- La app está diseñada para PostgreSQL (DISENO_FASE1.md §0.1). Este script te
-- da un MySQL local equivalente en TABLAS y en el blindaje del audit log, pero
-- hay DOS cosas que NO se traducen y debes tener en cuenta:
--
--   1) Prisma usa UN provider por esquema. Para que la APP corra contra este
--      MySQL tienes que cambiar en schema.prisma:
--          datasource db { provider = "mysql"  url = env("DATABASE_URL") }
--      y regenerar (prisma generate). NO uses este .sql y Prisma a la vez sobre
--      la misma BD: elige uno (o Prisma genera las tablas, o las creas con esto).
--
--   2) La búsqueda del Cerebro (search_cerebro) usa full-text de Postgres
--      (tsvector 'spanish' + GIN). Eso NO existe igual en MySQL. En local, la
--      tool debe usar el FALLBACK con LIKE que ya contempla DISENO §9. El índice
--      FULLTEXT de abajo es opcional y NO replica el ranking en español de prod.
--
-- Recomendado si puedes: usa Postgres local (Docker) — ver ../local/README.md —
-- para que local == prod y evites estas dos divergencias.
--
-- Uso:  mysql -u root -p < prisma/local/setup_mysql.sql
-- ─────────────────────────────────────────────────────────────────────────

CREATE DATABASE IF NOT EXISTS kaizen CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kaizen;

CREATE TABLE Partner (
  id            VARCHAR(191) NOT NULL,
  email         VARCHAR(191) NOT NULL,
  name          VARCHAR(191) NOT NULL,
  passwordHash  VARCHAR(191) NOT NULL,
  disabled      BOOLEAN      NOT NULL DEFAULT FALSE,
  createdAt     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY Partner_email_key (email)
) ENGINE=InnoDB;

CREATE TABLE Conversation (
  id             VARCHAR(191) NOT NULL,
  partnerId      VARCHAR(191) NOT NULL,
  title          VARCHAR(191) NOT NULL DEFAULT 'Nueva conversación',
  summary        LONGTEXT     NULL,
  summaryUpToSeq INT          NULL,
  createdAt      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updatedAt      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY Conversation_partnerId_updatedAt_idx (partnerId, updatedAt),
  CONSTRAINT Conversation_partnerId_fkey FOREIGN KEY (partnerId) REFERENCES Partner(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Message (
  id             VARCHAR(191) NOT NULL,
  conversationId VARCHAR(191) NOT NULL,
  seq            INT          NOT NULL,
  role           VARCHAR(191) NOT NULL,
  content        JSON         NOT NULL, -- bloques de la API de Anthropic tal cual
  inputTokens    INT          NULL,
  outputTokens   INT          NULL,
  stopReason     VARCHAR(191) NULL,
  createdAt      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY Message_conversationId_seq_key (conversationId, seq),
  CONSTRAINT Message_conversationId_fkey FOREIGN KEY (conversationId) REFERENCES Conversation(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE Proposal (
  id               VARCHAR(191) NOT NULL,
  conversationId   VARCHAR(191) NOT NULL,
  status           VARCHAR(191) NOT NULL DEFAULT 'PROPOSED',
  payload          JSON         NOT NULL, -- CampaignDraftInput completo = fuente de verdad
  segmentCount     INT          NULL,
  finzenCampaignId VARCHAR(191) NULL,
  confirmedAt      DATETIME(3)  NULL,
  confirmedBy      VARCHAR(191) NULL, -- solo lo escribe el endpoint HTTP, jamás el agente
  executedAt       DATETIME(3)  NULL,
  error            LONGTEXT     NULL,
  createdAt        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY Proposal_conversationId_status_idx (conversationId, status),
  CONSTRAINT Proposal_conversationId_fkey FOREIGN KEY (conversationId) REFERENCES Conversation(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE AuditLog (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  conversationId VARCHAR(191) NULL,
  actor          VARCHAR(191) NOT NULL,
  action         VARCHAR(191) NOT NULL,
  input          JSON         NULL,
  resultSummary  TEXT         NULL, -- truncado a 2000 chars por la app
  isError        BOOLEAN      NOT NULL DEFAULT FALSE,
  durationMs     INT          NULL,
  createdAt      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY AuditLog_createdAt_idx (createdAt),
  KEY AuditLog_action_createdAt_idx (action, createdAt)
) ENGINE=InnoDB;

CREATE TABLE CerebroDoc (
  id           VARCHAR(191) NOT NULL, -- fileId de Drive
  name         VARCHAR(191) NOT NULL,
  path         VARCHAR(191) NOT NULL,
  mimeType     VARCHAR(191) NOT NULL,
  text         LONGTEXT     NOT NULL, -- truncado a ~200KB por la app
  modifiedTime VARCHAR(191) NOT NULL,
  indexedAt    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  -- Opcional: full-text básico para el fallback local (NO equivale al 'spanish' de Postgres).
  FULLTEXT KEY CerebroDoc_ft (name, text)
) ENGINE=InnoDB;

-- Blindaje del audit log (append-only). MySQL no permite "UPDATE OR DELETE" en
-- un solo trigger: se crean dos, con SIGNAL para abortar la operación.
DROP TRIGGER IF EXISTS auditlog_no_update;
DROP TRIGGER IF EXISTS auditlog_no_delete;
DELIMITER //
CREATE TRIGGER auditlog_no_update BEFORE UPDATE ON AuditLog FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog es inmutable (append-only)';
END//
CREATE TRIGGER auditlog_no_delete BEFORE DELETE ON AuditLog FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog es inmutable (append-only)';
END//
DELIMITER ;
