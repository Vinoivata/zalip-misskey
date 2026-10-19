/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiChatRoom } from './ChatRoom.js';
import { MiChatMessage } from './ChatMessage.js';

/** Personal organisation only: never shared room moderation, message ownership or read state. */
@Entity('zalip_chat_conversation_setting')
@Index('IDX_zalip_chat_setting_user_archive_pin', ['userId', 'archivedAt', 'pinnedAt'])
@Check('CHK_zalip_chat_setting_target', '("otherUserId" IS NOT NULL AND "roomId" IS NULL AND "conversationKey" = \'user:\' || "otherUserId" AND "otherUserId" <> "userId") OR ("otherUserId" IS NULL AND "roomId" IS NOT NULL AND "conversationKey" = \'room:\' || "roomId")')
export class MiZalipChatConversationSetting {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_chat_conversation_setting' })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_zalip_chat_setting_user' })
	public user: MiUser | null;

	@PrimaryColumn('varchar', { length: 64, primaryKeyConstraintName: 'PK_zalip_chat_conversation_setting' })
	public conversationKey: string;

	@Column({ ...id(), nullable: true })
	public otherUserId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'otherUserId', foreignKeyConstraintName: 'FK_zalip_chat_setting_other_user' })
	public otherUser: MiUser | null;

	@Column({ ...id(), nullable: true })
	public roomId: MiChatRoom['id'] | null;

	@ManyToOne(() => MiChatRoom, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'roomId', foreignKeyConstraintName: 'FK_zalip_chat_setting_room' })
	public room: MiChatRoom | null;

	@Column('timestamp with time zone', { nullable: true })
	public pinnedAt: Date | null;

	@Column('timestamp with time zone', { nullable: true })
	public archivedAt: Date | null;

	@Column('boolean', { default: false })
	public isMuted: boolean;

	@Column({ ...id(), nullable: true })
	public pinnedMessageId: MiChatMessage['id'] | null;

	@ManyToOne(() => MiChatMessage, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'pinnedMessageId', foreignKeyConstraintName: 'FK_zalip_chat_setting_pinned_message' })
	public pinnedMessage: MiChatMessage | null;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
