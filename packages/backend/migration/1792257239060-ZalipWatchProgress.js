/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipWatchProgress1792257239060 {
    name = 'ZalipWatchProgress1792257239060';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_watch_progress" ("userId" character varying(32) NOT NULL, "workId" character varying(32) NOT NULL, "episodeId" character varying(32), "provider" character varying(16) NOT NULL, "translationId" character varying(100), "resourceId" character varying(100) NOT NULL, "positionSeconds" double precision, "durationSeconds" double precision, "completed" boolean NOT NULL DEFAULT false, "hidden" boolean NOT NULL DEFAULT false, "sessionId" uuid NOT NULL, "sequence" integer NOT NULL DEFAULT 0, "lastPlayedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_zalip_watch_progress" PRIMARY KEY ("userId", "workId"), CONSTRAINT "CHK_zalip_progress_provider" CHECK ("provider" IN ('alloha', 'collaps', 'kodik')), CONSTRAINT "CHK_zalip_progress_sequence" CHECK ("sequence" >= 0), CONSTRAINT "CHK_zalip_progress_duration" CHECK ("durationSeconds" IS NULL OR ("durationSeconds" > 0 AND "durationSeconds" <= 172800)), CONSTRAINT "CHK_zalip_progress_position" CHECK ("positionSeconds" IS NULL OR ("durationSeconds" IS NOT NULL AND "positionSeconds" >= 0 AND "positionSeconds" <= "durationSeconds")), CONSTRAINT "CHK_zalip_progress_time_provider" CHECK ("provider" = 'kodik' OR ("positionSeconds" IS NULL AND "durationSeconds" IS NULL)))`);
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" ADD "mode" character varying(16) NOT NULL`);
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" ADD CONSTRAINT "CHK_zalip_progress_mode" CHECK ("mode" IN ('time', 'episode'))`);
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" DROP CONSTRAINT "CHK_zalip_progress_time_provider"`);
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" ADD CONSTRAINT "CHK_zalip_progress_time_provider" CHECK (("mode" = 'time' AND "provider" = 'kodik') OR ("mode" = 'episode' AND "positionSeconds" IS NULL AND "durationSeconds" IS NULL))`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_progress_user_played_work" ON "zalip_watch_progress" ("userId", "lastPlayedAt", "workId")`);
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" ADD CONSTRAINT "FK_zalip_progress_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" ADD CONSTRAINT "FK_zalip_progress_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" ADD CONSTRAINT "FK_zalip_progress_episode" FOREIGN KEY ("episodeId") REFERENCES "zalip_episode"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "zalip_watch_progress"`);
    }
}
