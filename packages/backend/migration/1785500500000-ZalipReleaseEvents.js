/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipReleaseEvents1785500500000 {
    name = 'ZalipReleaseEvents1785500500000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_release_event" (
            "id" character varying(32) NOT NULL,
            "workId" character varying(32) NOT NULL,
            "seasonId" character varying(32) NOT NULL,
            "episodeId" character varying(32) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT "PK_zalip_release_event" PRIMARY KEY ("id"),
            CONSTRAINT "UQ_zalip_release_event_episode" UNIQUE ("episodeId"),
            CONSTRAINT "FK_zalip_release_event_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_zalip_release_event_season" FOREIGN KEY ("seasonId") REFERENCES "zalip_season"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_zalip_release_event_episode" FOREIGN KEY ("episodeId") REFERENCES "zalip_episode"("id") ON DELETE CASCADE
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_release_event_work_created" ON "zalip_release_event" ("workId", "createdAt")`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "zalip_release_event"`);
    }
}
