/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipTmdbCatalogueFacts1785500900000 {
    name = 'ZalipTmdbCatalogueFacts1785500900000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_work" ADD "genres" jsonb NOT NULL DEFAULT '[]'::jsonb`);
        await queryRunner.query(`ALTER TABLE "zalip_work" ADD "runtimeMinutes" integer`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_work" DROP COLUMN "runtimeMinutes"`);
        await queryRunner.query(`ALTER TABLE "zalip_work" DROP COLUMN "genres"`);
    }
}
