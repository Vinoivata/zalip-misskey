/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ZalipChatConversationSettings1792445862610 {
    name = 'ZalipChatConversationSettings1792445862610';

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "zalip_chat_conversation_setting" ("userId" character varying(32) NOT NULL, "conversationKey" character varying(64) NOT NULL, "otherUserId" character varying(32), "roomId" character varying(32), "pinnedAt" TIMESTAMP WITH TIME ZONE, "archivedAt" TIMESTAMP WITH TIME ZONE, "isMuted" boolean NOT NULL DEFAULT false, "pinnedMessageId" character varying(32), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_zalip_chat_conversation_setting" PRIMARY KEY ("userId", "conversationKey"), CONSTRAINT "CHK_zalip_chat_setting_target" CHECK (("otherUserId" IS NOT NULL AND "roomId" IS NULL AND "conversationKey" = 'user:' || "otherUserId" AND "otherUserId" <> "userId") OR ("otherUserId" IS NULL AND "roomId" IS NOT NULL AND "conversationKey" = 'room:' || "roomId")))`);
        await queryRunner.query(`CREATE INDEX "IDX_zalip_chat_setting_user_archive_pin" ON "zalip_chat_conversation_setting" ("userId", "archivedAt", "pinnedAt")`);
        await queryRunner.query(`ALTER TABLE "zalip_chat_conversation_setting" ADD CONSTRAINT "FK_zalip_chat_setting_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_chat_conversation_setting" ADD CONSTRAINT "FK_zalip_chat_setting_other_user" FOREIGN KEY ("otherUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_chat_conversation_setting" ADD CONSTRAINT "FK_zalip_chat_setting_room" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "zalip_chat_conversation_setting" ADD CONSTRAINT "FK_zalip_chat_setting_pinned_message" FOREIGN KEY ("pinnedMessageId") REFERENCES "chat_message"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        // Native messages, memberships, read frontiers and user-level mutes remain intact.
        await queryRunner.query(`DROP TABLE "zalip_chat_conversation_setting"`);
    }
}
