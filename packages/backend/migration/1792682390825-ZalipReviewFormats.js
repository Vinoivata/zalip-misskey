/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipReviewFormats1792682390825 {
    name = 'ZalipReviewFormats1792682390825';

    async up(queryRunner) {
        // Add the stronger identity before removing the old constraint. No rows,
        // ids, dates, author decisions, votes or native library scores are rewritten.
        await queryRunner.query(`ALTER TABLE "zalip_review" ADD CONSTRAINT "UQ_zalip_review_user_work_format" UNIQUE ("userId", "workId", "format")`);
        await queryRunner.query(`ALTER TABLE "zalip_review" DROP CONSTRAINT "UQ_zalip_review_user_work"`);
    }

    async down(queryRunner) {
        // The migration runner wraps this migration in a transaction. Prevent a
        // concurrent writer from introducing another format between check and DDL.
        await queryRunner.query(`LOCK TABLE "zalip_review" IN ACCESS EXCLUSIVE MODE`);
        await queryRunner.query(`DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM "zalip_review" GROUP BY "userId", "workId" HAVING COUNT(*) > 1) THEN
                RAISE EXCEPTION 'Cannot restore one review per work while multiple formats exist; preserve and resolve all materials before rollback.' USING ERRCODE = '23514';
            END IF;
        END $$`);
        // Soft-removed materials count too: rollback must not discard recoverable
        // opinions. A conflict fails before either constraint is changed.
        await queryRunner.query(`ALTER TABLE "zalip_review" ADD CONSTRAINT "UQ_zalip_review_user_work" UNIQUE ("userId", "workId")`);
        await queryRunner.query(`ALTER TABLE "zalip_review" DROP CONSTRAINT "UQ_zalip_review_user_work_format"`);
    }
}
