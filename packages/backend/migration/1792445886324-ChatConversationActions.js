/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class ChatConversationActions1792445886324 {
    name = 'ChatConversationActions1792445886324';

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "chat_message" ADD "updatedAt" TIMESTAMP WITH TIME ZONE, ADD "replyId" character varying(32), ADD "forwardedFromUserId" character varying(32)`);
        await queryRunner.query(`CREATE INDEX "IDX_chat_message_reply" ON "chat_message" ("replyId")`);
        await queryRunner.query(`ALTER TABLE "chat_message" ADD CONSTRAINT "FK_chat_message_reply" FOREIGN KEY ("replyId") REFERENCES "chat_message"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "chat_message" ADD CONSTRAINT "FK_chat_message_forwarded_user" FOREIGN KEY ("forwardedFromUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`CREATE TABLE "chat_read_cursor" ("userId" character varying(32) NOT NULL, "conversationKey" character varying(64) NOT NULL, "readThroughId" character varying(32) NOT NULL, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_chat_read_cursor" PRIMARY KEY ("userId", "conversationKey"), CONSTRAINT "CHK_chat_read_cursor_key" CHECK ("conversationKey" ~ '^(user|room):[A-Za-z0-9]{1,32}$'))`);
        await queryRunner.query(`ALTER TABLE "chat_read_cursor" ADD CONSTRAINT "FK_chat_read_cursor_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP TABLE "chat_read_cursor"`);
        await queryRunner.query(`ALTER TABLE "chat_message" DROP CONSTRAINT "FK_chat_message_forwarded_user"`);
        await queryRunner.query(`ALTER TABLE "chat_message" DROP CONSTRAINT "FK_chat_message_reply"`);
        await queryRunner.query(`DROP INDEX "IDX_chat_message_reply"`);
        await queryRunner.query(`ALTER TABLE "chat_message" DROP COLUMN "forwardedFromUserId", DROP COLUMN "replyId", DROP COLUMN "updatedAt"`);
    }
}
