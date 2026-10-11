/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipImporterSourceSettings1791752500200 {
    name = 'ZalipImporterSourceSettings1791752500200';

    async up(q) {
        await q.query(`CREATE TABLE "zalip_importer_source_setting" ("source" varchar(16) NOT NULL, "apiOrigin" varchar(1024) NOT NULL, "playerOrigin" varchar(1024), "encryptedTokens" jsonb, "updatedAt" timestamp with time zone NOT NULL, CONSTRAINT "PK_zalip_importer_source_setting" PRIMARY KEY ("source"))`);
    }

    async down(q) {
        await q.query(`DROP TABLE "zalip_importer_source_setting"`);
    }
}
