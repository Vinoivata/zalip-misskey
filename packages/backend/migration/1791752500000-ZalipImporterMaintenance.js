/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipImporterMaintenance1791752500000 {
    name = 'ZalipImporterMaintenance1791752500000';

    async up(q) {
        await q.query(`CREATE TABLE "zalip_maintenance_profile" ("id" varchar(32) NOT NULL, "createdAt" timestamp with time zone NOT NULL, "updatedAt" timestamp with time zone NOT NULL, "name" varchar(120) NOT NULL, "kind" varchar(32) NOT NULL, "source" varchar(16) NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "intervalMinutes" integer NOT NULL DEFAULT 1440, "batchLimit" integer NOT NULL DEFAULT 20, "timeBudgetSeconds" integer NOT NULL DEFAULT 60, "options" jsonb NOT NULL DEFAULT '{}'::jsonb, "cursor" jsonb NOT NULL DEFAULT '{"page":1,"offset":0,"entryAfterId":null,"activeEntryId":null,"collectionIndex":0}'::jsonb, "lastRunAt" timestamp with time zone, "nextRunAt" timestamp with time zone, "lastError" varchar(128), CONSTRAINT "PK_zalip_maintenance_profile" PRIMARY KEY ("id"))`);
        await q.query(`CREATE INDEX "IDX_zalip_maintenance_profile_due" ON "zalip_maintenance_profile" ("enabled", "nextRunAt")`);
        await q.query(`CREATE TABLE "zalip_maintenance_run" ("id" varchar(32) NOT NULL, "createdAt" timestamp with time zone NOT NULL, "updatedAt" timestamp with time zone NOT NULL, "finishedAt" timestamp with time zone, "createdById" varchar(32), "profileId" varchar(32), "kind" varchar(32) NOT NULL, "source" varchar(16) NOT NULL, "state" varchar(16) NOT NULL DEFAULT 'queued', "batchLimit" integer NOT NULL DEFAULT 20, "timeBudgetSeconds" integer NOT NULL DEFAULT 60, "options" jsonb NOT NULL DEFAULT '{}'::jsonb, "cursor" jsonb NOT NULL DEFAULT '{"page":1,"offset":0,"entryAfterId":null,"activeEntryId":null,"collectionIndex":0}'::jsonb, "stats" jsonb NOT NULL DEFAULT '{"processed":0,"created":0,"updated":0,"linked":0,"skipped":0,"failed":0}'::jsonb, "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb, "error" varchar(128), "retryAfter" timestamp with time zone, CONSTRAINT "PK_zalip_maintenance_run" PRIMARY KEY ("id"), CONSTRAINT "FK_zalip_maintenance_run_profile" FOREIGN KEY ("profileId") REFERENCES "zalip_maintenance_profile"("id") ON DELETE SET NULL)`);
        await q.query(`CREATE INDEX "IDX_zalip_maintenance_run_state_updated" ON "zalip_maintenance_run" ("state", "updatedAt")`);
        await q.query(`CREATE INDEX "IDX_zalip_maintenance_run_profile_state" ON "zalip_maintenance_run" ("profileId", "state")`);
    }

    async down(q) {
        await q.query(`DROP TABLE "zalip_maintenance_run"`);
        await q.query(`DROP TABLE "zalip_maintenance_profile"`);
    }
}
