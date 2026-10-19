/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipReviews1792442405046 {
    name = 'ZalipReviews1792442405046';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_review" ("id" character varying(32) NOT NULL, "userId" character varying(32) NOT NULL, "workId" character varying(32) NOT NULL, "format" character varying(16) NOT NULL, "title" character varying(200), "body" character varying(12000) NOT NULL, "isSpoiler" boolean NOT NULL DEFAULT false, "sentiment" character varying(16) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "deletedAt" TIMESTAMP WITH TIME ZONE, "deletedById" character varying(32), CONSTRAINT "PK_zalip_review" PRIMARY KEY ("id"), CONSTRAINT "UQ_zalip_review_user_work" UNIQUE ("userId", "workId"), CONSTRAINT "CHK_zalip_review_format" CHECK ("format" IN ('review', 'essay')), CONSTRAINT "CHK_zalip_review_sentiment" CHECK ("sentiment" IN ('positive', 'neutral', 'negative')), CONSTRAINT "CHK_zalip_review_body" CHECK (char_length(btrim("body")) BETWEEN 20 AND 12000), CONSTRAINT "CHK_zalip_review_title" CHECK ("format" <> 'essay' OR ("title" IS NOT NULL AND char_length(btrim("title")) BETWEEN 1 AND 200)))`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_review_work_deleted_created" ON "zalip_review" ("workId", "deletedAt", "createdAt")`);
        await queryRunner.query(`ALTER TABLE "zalip_review" ADD CONSTRAINT "FK_zalip_review_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_review" ADD CONSTRAINT "FK_zalip_review_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_review" ADD CONSTRAINT "FK_zalip_review_deleted_by" FOREIGN KEY ("deletedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TABLE "zalip_review_vote" ("userId" character varying(32) NOT NULL, "reviewId" character varying(32) NOT NULL, "value" character varying(16) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_zalip_review_vote" PRIMARY KEY ("userId", "reviewId"), CONSTRAINT "CHK_zalip_review_vote_value" CHECK ("value" IN ('helpful', 'unhelpful')))`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_review_vote_review_value" ON "zalip_review_vote" ("reviewId", "value")`);
        await queryRunner.query(`ALTER TABLE "zalip_review_vote" ADD CONSTRAINT "FK_zalip_review_vote_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_review_vote" ADD CONSTRAINT "FK_zalip_review_vote_review" FOREIGN KEY ("reviewId") REFERENCES "zalip_review"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        // Native title ratings, library states, comments and catalogue rows remain intact.
        await queryRunner.query(`DROP TABLE "zalip_review_vote"`);
        await queryRunner.query(`DROP TABLE "zalip_review"`);
    }
}
