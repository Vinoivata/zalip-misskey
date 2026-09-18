/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipAllohaPlayback1785501000000 {
    name = 'ZalipAllohaPlayback1785501000000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_alloha_source" ("id" character varying(32) NOT NULL, "workId" character varying(32) NOT NULL, "category" character varying(24) NOT NULL, "isAvailable" boolean NOT NULL DEFAULT false, "iframe" character varying(2048), "translations" jsonb NOT NULL DEFAULT '[]'::jsonb, "lastCheckedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_zalip_alloha_source_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_zalip_alloha_source_work" ON "zalip_alloha_source" ("workId")`);
        await queryRunner.query(`ALTER TABLE "zalip_alloha_source" ADD CONSTRAINT "FK_zalip_alloha_source_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "zalip_alloha_availability_event" ("id" character varying(32) NOT NULL, "workId" character varying(32) NOT NULL, "availabilityKey" character varying(64) NOT NULL, "seasonNumber" integer, "episodeNumber" integer, "translationCount" integer NOT NULL DEFAULT 0, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "notificationDeliveredAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_zalip_alloha_availability_event_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_zalip_alloha_availability_unique" ON "zalip_alloha_availability_event" ("workId", "availabilityKey")`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_alloha_availability_created" ON "zalip_alloha_availability_event" ("createdAt")`);
        await queryRunner.query(`ALTER TABLE "zalip_alloha_availability_event" ADD CONSTRAINT "FK_zalip_alloha_availability_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_alloha_availability_event" DROP CONSTRAINT "FK_zalip_alloha_availability_work"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_alloha_availability_created"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_alloha_availability_unique"`);
        await queryRunner.query(`DROP TABLE "zalip_alloha_availability_event"`);
        await queryRunner.query(`ALTER TABLE "zalip_alloha_source" DROP CONSTRAINT "FK_zalip_alloha_source_work"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_alloha_source_work"`);
        await queryRunner.query(`DROP TABLE "zalip_alloha_source"`);
    }
}
