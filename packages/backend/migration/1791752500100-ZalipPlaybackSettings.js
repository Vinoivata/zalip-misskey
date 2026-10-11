/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipPlaybackSettings1791752500100 {
    name = 'ZalipPlaybackSettings1791752500100';

    async up(q) {
        await q.query(`CREATE TABLE "zalip_playback_settings" ("id" character varying(16) NOT NULL, "providers" jsonb NOT NULL DEFAULT '[]'::jsonb, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_zalip_playback_settings" PRIMARY KEY ("id"))`);
    }

    async down(q) {
        await q.query(`DROP TABLE "zalip_playback_settings"`);
    }
}
