/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipWatchProgressTimeProviders1792273818692 {
    name = 'ZalipWatchProgressTimeProviders1792273818692';

    async up(queryRunner) {
        // One atomic ALTER: preserve every existing row and never leave the check absent.
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" DROP CONSTRAINT "CHK_zalip_progress_time_provider", ADD CONSTRAINT "CHK_zalip_progress_time_provider" CHECK (("mode" = 'time' AND "provider" IN ('alloha', 'collaps', 'kodik')) OR ("mode" = 'episode' AND "positionSeconds" IS NULL AND "durationSeconds" IS NULL))`);
    }

    async down(queryRunner) {
        // The lock, refusal and ALTER share one statement/transaction even outside TypeORM's default wrapper.
        // New-provider history must be explicitly preserved by the operator, never deleted or downgraded here.
        await queryRunner.query(`DO $zalip_progress$
BEGIN
    LOCK TABLE "zalip_watch_progress" IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM "zalip_watch_progress" WHERE "mode" = 'time' AND "provider" <> 'kodik') THEN
        RAISE EXCEPTION 'Cannot downgrade while non-Kodik time progress exists' USING ERRCODE = '23514';
    END IF;
    ALTER TABLE "zalip_watch_progress" DROP CONSTRAINT "CHK_zalip_progress_time_provider", ADD CONSTRAINT "CHK_zalip_progress_time_provider" CHECK (("mode" = 'time' AND "provider" = 'kodik') OR ("mode" = 'episode' AND "positionSeconds" IS NULL AND "durationSeconds" IS NULL));
END;
$zalip_progress$`);
    }
}
