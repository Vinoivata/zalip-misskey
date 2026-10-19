/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const concurrent = process.env.MISSKEY_MIGRATION_CREATE_INDEX_CONCURRENTLY === '1';
const indexes = [
    ['IDX_zalip_chat_message_from_to_id', '"fromUserId", "toUserId", "id"', '"toRoomId" IS NULL'],
    ['IDX_zalip_chat_message_to_from_id', '"toUserId", "fromUserId", "id"', '"toRoomId" IS NULL'],
    ['IDX_zalip_chat_message_room_id', '"toRoomId", "id"', '"toRoomId" IS NOT NULL'],
];

export class ZalipChatConversationIndexes1792446213099 {
    name = 'ZalipChatConversationIndexes1792446213099';
    transaction = concurrent ? false : undefined;

    async up(queryRunner) {
        for (const [name, columns, predicate] of indexes) {
            if (concurrent) {
                // A canceled concurrent build leaves an invalid index. Recover only this exact
                // migration-owned public index, never rewrite any pre-existing native index.
                const existing = await queryRunner.query(`SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = $1`, [name]);
                if (existing[0]?.indisvalid === true) continue;
                await queryRunner.query(`DROP INDEX CONCURRENTLY IF EXISTS "public"."${name}"`);
            }
            await queryRunner.query(`CREATE INDEX ${concurrent ? 'CONCURRENTLY ' : ''}IF NOT EXISTS "${name}" ON "chat_message" (${columns}) WHERE ${predicate}`);
        }
    }

    async down(queryRunner) {
        for (const [name] of [...indexes].reverse()) {
            await queryRunner.query(`DROP INDEX ${concurrent ? 'CONCURRENTLY ' : ''}IF EXISTS "public"."${name}"`);
        }
    }
}
