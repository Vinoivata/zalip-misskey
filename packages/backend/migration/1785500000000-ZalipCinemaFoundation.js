/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipCinemaFoundation1785500000000 {
    name = 'ZalipCinemaFoundation1785500000000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_work" (
            "id" character varying(32) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "publishedAt" TIMESTAMP WITH TIME ZONE,
            "slug" character varying(160) NOT NULL,
            "kind" character varying(16) NOT NULL,
            "publicationState" character varying(16) NOT NULL DEFAULT 'draft',
            "title" character varying(256) NOT NULL,
            "originalTitle" character varying(256),
            "description" character varying(8192),
            "releaseYear" integer,
            "tmdbMediaType" character varying(16),
            "tmdbId" integer,
            "posterPath" character varying(512),
            "backdropPath" character varying(512),
            "trailerYoutubeKey" character varying(32),
            CONSTRAINT "PK_zalip_work_id" PRIMARY KEY ("id"),
            CONSTRAINT "CHK_zalip_work_kind" CHECK ("kind" IN ('movie', 'series', 'anime', 'animation')),
            CONSTRAINT "CHK_zalip_work_publication_state" CHECK ("publicationState" IN ('draft', 'published', 'archived')),
            CONSTRAINT "CHK_zalip_work_release_year" CHECK ("releaseYear" IS NULL OR "releaseYear" >= 1888),
            CONSTRAINT "CHK_zalip_work_tmdb_type" CHECK ("tmdbMediaType" IS NULL OR "tmdbMediaType" IN ('movie', 'tv')),
            CONSTRAINT "CHK_zalip_work_tmdb_id" CHECK ("tmdbId" IS NULL OR "tmdbId" > 0)
        )`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_zalip_work_slug" ON "zalip_work" ("slug")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_zalip_work_tmdb" ON "zalip_work" ("tmdbMediaType", "tmdbId")`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_work_publication_published" ON "zalip_work" ("publicationState", "publishedAt")`);

        await queryRunner.query(`CREATE TABLE "zalip_library_entry" (
            "userId" character varying(32) NOT NULL,
            "workId" character varying(32) NOT NULL,
            "status" character varying(16) NOT NULL DEFAULT 'planned',
            "episodesWatched" integer NOT NULL DEFAULT 0,
            "personalRating" integer,
            "isFavorite" boolean NOT NULL DEFAULT false,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT "PK_zalip_library_entry" PRIMARY KEY ("userId", "workId"),
            CONSTRAINT "CHK_zalip_library_status" CHECK ("status" IN ('watching', 'planned', 'completed', 'on_hold', 'dropped')),
            CONSTRAINT "CHK_zalip_library_episodes" CHECK ("episodesWatched" >= 0),
            CONSTRAINT "CHK_zalip_library_rating" CHECK ("personalRating" IS NULL OR ("personalRating" >= 1 AND "personalRating" <= 10)),
            CONSTRAINT "FK_zalip_library_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_zalip_library_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_library_user_status_updated" ON "zalip_library_entry" ("userId", "status", "updatedAt")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_library_user_status_updated"`);
        await queryRunner.query(`DROP TABLE "zalip_library_entry"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_work_publication_published"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_work_tmdb"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_work_slug"`);
        await queryRunner.query(`DROP TABLE "zalip_work"`);
    }
}
