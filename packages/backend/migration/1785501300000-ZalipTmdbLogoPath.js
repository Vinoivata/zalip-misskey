/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipTmdbLogoPath1785501300000 {
    name = 'ZalipTmdbLogoPath1785501300000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_work" ADD "logoPath" character varying(512)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_work" DROP COLUMN "logoPath"`);
    }
}
