/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipTmdbGalleryPaths1785500800000 {
    name = 'ZalipTmdbGalleryPaths1785500800000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_work" ADD "galleryPaths" jsonb NOT NULL DEFAULT '[]'::jsonb`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_work" DROP COLUMN "galleryPaths"`);
    }
}
