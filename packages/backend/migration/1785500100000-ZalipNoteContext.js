/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipNoteContext1785500100000 {
    name = 'ZalipNoteContext1785500100000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_note_context" (
            "workId" character varying(32) NOT NULL,
            "noteId" character varying(32) NOT NULL,
            "createdById" character varying(32) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT "PK_zalip_note_context" PRIMARY KEY ("workId"),
            CONSTRAINT "UQ_zalip_note_context_note" UNIQUE ("noteId"),
            CONSTRAINT "FK_zalip_note_context_work" FOREIGN KEY ("workId") REFERENCES "zalip_work"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_zalip_note_context_note" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_zalip_note_context_creator" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE
        )`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "zalip_note_context"`);
    }
}
