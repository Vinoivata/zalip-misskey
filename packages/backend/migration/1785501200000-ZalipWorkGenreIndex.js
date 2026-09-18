/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipWorkGenreIndex1785501200000 {
    name = 'ZalipWorkGenreIndex1785501200000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE INDEX "IDX_zalip_work_genres_gin" ON "zalip_work" USING GIN ("genres")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_work_genres_gin"`);
    }
}
