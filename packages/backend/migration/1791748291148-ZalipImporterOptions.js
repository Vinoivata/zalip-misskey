/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipImporterOptions1791748291148 {
    name = 'ZalipImporterOptions1791748291148';

    async up(q) {
        await q.query(`ALTER TABLE "zalip_import_run" ADD "options" jsonb NOT NULL DEFAULT '{}'::jsonb`);
        await q.query(`ALTER TABLE "zalip_import_profile" ADD "options" jsonb NOT NULL DEFAULT '{}'::jsonb`);
        await q.query(`ALTER TABLE "zalip_import_item" ADD "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    }

    async down(q) {
        // Disable the new-only profile mode when reverting to an older application binary.
        await q.query(`UPDATE "zalip_import_profile" SET "enabled" = false, "nextRunAt" = NULL WHERE "mode" = 'discovery'`);
        await q.query(`ALTER TABLE "zalip_import_item" DROP COLUMN "warnings"`);
        await q.query(`ALTER TABLE "zalip_import_profile" DROP COLUMN "options"`);
        await q.query(`ALTER TABLE "zalip_import_run" DROP COLUMN "options"`);
    }
}
