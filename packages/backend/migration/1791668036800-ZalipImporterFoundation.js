/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipImporterFoundation1791668036800 {
    name = 'ZalipImporterFoundation1791668036800';

    async up(q) {
        await q.query(`ALTER TABLE "zalip_work" ADD "importData" jsonb NOT NULL DEFAULT '{}'::jsonb`);
        await q.query(`ALTER TABLE "zalip_season" ADD "importValues" jsonb NOT NULL DEFAULT '{}'::jsonb`);
        await q.query(`ALTER TABLE "zalip_episode" ADD "importValues" jsonb NOT NULL DEFAULT '{}'::jsonb`);
        await q.query(`CREATE TABLE "zalip_import_run" (
            "id" varchar(32) CONSTRAINT "PK_zalip_import_run" PRIMARY KEY, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
            "createdById" varchar(32), "profileId" varchar(32), "mode" varchar(16) NOT NULL,
            "state" varchar(16) NOT NULL DEFAULT 'queued', "lockedFields" jsonb NOT NULL DEFAULT '[]'::jsonb,
            "categoryIds" jsonb NOT NULL DEFAULT '[]'::jsonb, "error" varchar(128), "retryAt" timestamptz
        )`);
        await q.query(`CREATE INDEX "IDX_zalip_import_run_state_updated" ON "zalip_import_run" ("state", "updatedAt")`);
        await q.query(`CREATE TABLE "zalip_import_item" (
            "id" varchar(32) CONSTRAINT "PK_zalip_import_item" PRIMARY KEY, "runId" varchar(32) NOT NULL, "position" integer NOT NULL,
            "state" varchar(16) NOT NULL DEFAULT 'pending', "ref" jsonb NOT NULL, "workId" varchar(32),
            "error" varchar(128), "updatedAt" timestamptz NOT NULL,
            CONSTRAINT "FK_zalip_import_item_run" FOREIGN KEY ("runId") REFERENCES "zalip_import_run"("id") ON DELETE CASCADE
        )`);
        await q.query(`CREATE UNIQUE INDEX "IDX_zalip_import_item_run_position" ON "zalip_import_item" ("runId", "position")`);
        await q.query(`CREATE TABLE "zalip_external_identity" (
            "id" varchar(32) CONSTRAINT "PK_zalip_external_identity" PRIMARY KEY, "workId" varchar(32) NOT NULL, "provider" varchar(16) NOT NULL,
            "entityType" varchar(16) NOT NULL, "externalId" varchar(100) NOT NULL,
            "snapshot" jsonb, "updatedAt" timestamptz NOT NULL,
            CONSTRAINT "FK_zalip_external_identity_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE
        )`);
        await q.query(`CREATE UNIQUE INDEX "IDX_zalip_external_identity_key" ON "zalip_external_identity" ("provider", "entityType", "externalId")`);
        await q.query(`CREATE INDEX "IDX_zalip_external_identity_work" ON "zalip_external_identity" ("workId")`);
        await q.query(`CREATE TABLE "zalip_import_profile" (
            "id" varchar(32) CONSTRAINT "PK_zalip_import_profile" PRIMARY KEY, "name" varchar(120) NOT NULL, "enabled" boolean NOT NULL DEFAULT false,
            "source" varchar(16) NOT NULL, "mode" varchar(16) NOT NULL, "intervalMinutes" integer NOT NULL DEFAULT 1440,
            "collectionId" varchar(100), "lockedFields" jsonb NOT NULL DEFAULT '[]'::jsonb,
            "categoryIds" jsonb NOT NULL DEFAULT '[]'::jsonb, "lastRunAt" timestamptz, "nextRunAt" timestamptz,
            "lastError" varchar(128), "cursor" integer NOT NULL DEFAULT 0
        )`);
        await q.query(`CREATE INDEX "IDX_zalip_import_profile_next" ON "zalip_import_profile" ("enabled", "nextRunAt")`);
    }

    async down(q) {
        await q.query(`DROP TABLE "zalip_import_profile"`);
        await q.query(`DROP TABLE "zalip_external_identity"`);
        await q.query(`DROP TABLE "zalip_import_item"`);
        await q.query(`DROP TABLE "zalip_import_run"`);
        await q.query(`ALTER TABLE "zalip_episode" DROP COLUMN "importValues"`);
        await q.query(`ALTER TABLE "zalip_season" DROP COLUMN "importValues"`);
        await q.query(`ALTER TABLE "zalip_work" DROP COLUMN "importData"`);
    }
}
