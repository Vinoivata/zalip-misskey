/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipSharedNotes1785501100000 {
    name = 'ZalipSharedNotes1785501100000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_shared_note" ("noteId" character varying(32) NOT NULL, "workId" character varying(32) NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_zalip_shared_note_note" PRIMARY KEY ("noteId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_shared_note_work_created" ON "zalip_shared_note" ("workId", "createdAt")`);
        await queryRunner.query(`ALTER TABLE "zalip_shared_note" ADD CONSTRAINT "FK_zalip_shared_note_note" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_shared_note" ADD CONSTRAINT "FK_zalip_shared_note_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "zalip_shared_note" DROP CONSTRAINT "FK_zalip_shared_note_work"`);
        await queryRunner.query(`ALTER TABLE "zalip_shared_note" DROP CONSTRAINT "FK_zalip_shared_note_note"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_zalip_shared_note_work_created"`);
        await queryRunner.query(`DROP TABLE "zalip_shared_note"`);
    }
}
