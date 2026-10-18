/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipNoteViews1792344215050 {
    name = 'ZalipNoteViews1792344215050';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_note_view_stat" ("noteId" character varying(32) NOT NULL, "count" bigint NOT NULL DEFAULT 0, CONSTRAINT "PK_zalip_note_view_stat" PRIMARY KEY ("noteId"), CONSTRAINT "CHK_zalip_note_view_count" CHECK ("count" >= 0 AND "count" <= 9007199254740991))`);
        await queryRunner.query(`ALTER TABLE "zalip_note_view_stat" ADD CONSTRAINT "FK_zalip_note_view_stat_note" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        // Only the new aggregate is removed; native notes and all existing data stay untouched.
        await queryRunner.query(`DROP TABLE "zalip_note_view_stat"`);
    }
}
