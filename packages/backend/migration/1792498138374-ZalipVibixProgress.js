/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipVibixProgress1792498138374 {
    name = 'ZalipVibixProgress1792498138374';

    async up(queryRunner) {
        // Expand only the target-provider check. Vibix cannot store invented time progress.
        // Preserve per-element casts so down restores the PostgreSQL catalog expression exactly.
        await queryRunner.query(`ALTER TABLE "zalip_watch_progress" DROP CONSTRAINT "CHK_zalip_progress_provider", ADD CONSTRAINT "CHK_zalip_progress_provider" CHECK (("provider")::text = ANY (ARRAY[('alloha'::character varying)::text, ('collaps'::character varying)::text, ('kodik'::character varying)::text, ('vibix'::character varying)::text]))`);
    }

    async down(queryRunner) {
        // Never erase or rewrite personal history to make an older schema accept it.
        await queryRunner.query(`DO $zalip_vibix$
BEGIN
    LOCK TABLE "zalip_watch_progress" IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM "zalip_watch_progress" WHERE "provider" = 'vibix') THEN
        RAISE EXCEPTION 'Cannot downgrade while Vibix progress exists' USING ERRCODE = '23514';
    END IF;
    ALTER TABLE "zalip_watch_progress" DROP CONSTRAINT "CHK_zalip_progress_provider", ADD CONSTRAINT "CHK_zalip_progress_provider" CHECK (("provider")::text = ANY (ARRAY[('alloha'::character varying)::text, ('collaps'::character varying)::text, ('kodik'::character varying)::text]));
END;
$zalip_vibix$`);
    }
}
