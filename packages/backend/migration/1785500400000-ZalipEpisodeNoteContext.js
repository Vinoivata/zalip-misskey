/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipEpisodeNoteContext1785500400000 {
    name = 'ZalipEpisodeNoteContext1785500400000'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_episode_note_context" (
            "episodeId" character varying(32) NOT NULL,
            "noteId" character varying(32) NOT NULL,
            "createdById" character varying(32) NOT NULL,
            "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT "PK_zalip_episode_note_context" PRIMARY KEY ("episodeId"),
            CONSTRAINT "UQ_zalip_episode_note_context_note" UNIQUE ("noteId"),
            CONSTRAINT "FK_zalip_episode_note_context_episode" FOREIGN KEY ("episodeId") REFERENCES "zalip_episode"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_zalip_episode_note_context_note" FOREIGN KEY ("noteId") REFERENCES "note"("id") ON DELETE CASCADE,
            CONSTRAINT "FK_zalip_episode_note_context_creator" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE CASCADE
        )`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "zalip_episode_note_context"`);
    }
}
