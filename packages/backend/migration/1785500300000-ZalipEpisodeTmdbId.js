/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipEpisodeTmdbId1785500300000 {
    name = 'ZalipEpisodeTmdbId1785500300000'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_episode" ADD "tmdbEpisodeId" integer`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_episode" DROP COLUMN "tmdbEpisodeId"`);
    }
}
