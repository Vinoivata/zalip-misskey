/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipSeasonsEpisodes1785500200000 {
    name = 'ZalipSeasonsEpisodes1785500200000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_season" (
            "id" character varying(32) NOT NULL,
            "workId" character varying(32) NOT NULL,
            "seasonNumber" integer NOT NULL,
            "title" character varying(256) NOT NULL,
            "originalTitle" character varying(256),
            "description" character varying(8192),
            "posterPath" character varying(512),
            "airDate" character varying(10),
            "episodeCount" integer,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT "PK_zalip_season" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_zalip_season_work_number" UNIQUE ("workId", "seasonNumber"),
            CONSTRAINT "CHK_zalip_season_number" CHECK ("seasonNumber" >= 0),
            CONSTRAINT "CHK_zalip_season_episode_count" CHECK ("episodeCount" IS NULL OR "episodeCount" >= 0),
            CONSTRAINT "FK_zalip_season_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE TABLE "zalip_episode" (
            "id" character varying(32) NOT NULL,
            "seasonId" character varying(32) NOT NULL,
            "episodeNumber" integer NOT NULL,
            "title" character varying(256) NOT NULL,
            "originalTitle" character varying(256),
            "description" character varying(8192),
            "airDate" character varying(10),
            "stillPath" character varying(512),
            "runtimeMinutes" integer,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT "PK_zalip_episode" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_zalip_episode_season_number" UNIQUE ("seasonId", "episodeNumber"),
            CONSTRAINT "CHK_zalip_episode_number" CHECK ("episodeNumber" >= 0),
            CONSTRAINT "CHK_zalip_episode_runtime" CHECK ("runtimeMinutes" IS NULL OR "runtimeMinutes" > 0),
            CONSTRAINT "FK_zalip_episode_season" FOREIGN KEY ("seasonId") REFERENCES "zalip_season"("id") ON DELETE CASCADE
        )`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "zalip_episode"`);
        await queryRunner.query(`DROP TABLE "zalip_season"`);
    }
}
