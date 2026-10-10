/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipCatalogDirectories1791667822000 {
    name = 'ZalipCatalogDirectories1791667822000';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_catalog_entry" (
            "id" character varying(32) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "type" character varying(16) NOT NULL,
            "slug" character varying(160) NOT NULL,
            "name" character varying(256) NOT NULL,
            "description" character varying(8192),
            "imageUrl" character varying(1024),
            "externalIds" jsonb NOT NULL DEFAULT '{}'::jsonb,
            "data" jsonb NOT NULL DEFAULT '{}'::jsonb,
            "parentId" character varying(32),
            CONSTRAINT "PK_zalip_catalog_entry" PRIMARY KEY ("id"),
            CONSTRAINT "FK_zalip_catalog_entry_parent" FOREIGN KEY ("parentId") REFERENCES "zalip_catalog_entry"("id") ON DELETE SET NULL
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_zalip_catalog_entry_type_slug" ON "zalip_catalog_entry" ("type", "slug")`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_catalog_entry_type_name" ON "zalip_catalog_entry" ("type", "name")`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_catalog_entry_parent" ON "zalip_catalog_entry" ("parentId")`);
        await queryRunner.query(`CREATE TABLE "zalip_catalog_relation" (
            "id" character varying(32) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "entryId" character varying(32) NOT NULL,
            "workId" character varying(32) NOT NULL,
            "role" character varying(64) NOT NULL DEFAULT '',
            "character" character varying(256),
            "position" integer NOT NULL DEFAULT 0,
            "source" character varying(32) NOT NULL DEFAULT 'manual',
            CONSTRAINT "PK_zalip_catalog_relation" PRIMARY KEY ("id"),
            CONSTRAINT "CHK_zalip_catalog_relation_position" CHECK ("position" >= 0),
            CONSTRAINT "FK_zalip_catalog_relation_entry" FOREIGN KEY ("entryId") REFERENCES "zalip_catalog_entry"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_zalip_catalog_relation_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_zalip_catalog_relation_identity" ON "zalip_catalog_relation" ("entryId", "workId", "role", "source")`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_catalog_relation_work" ON "zalip_catalog_relation" ("workId")`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_catalog_relation_entry" ON "zalip_catalog_relation" ("entryId")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "zalip_catalog_relation"`);
        await queryRunner.query(`DROP TABLE "zalip_catalog_entry"`);
    }
}
