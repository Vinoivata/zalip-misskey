/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PrimaryColumn, Entity, Index, JoinColumn, Column, ManyToOne } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiDriveFile } from './DriveFile.js';
import { MiChatRoom } from './ChatRoom.js';

@Entity('chat_message')
@Index('IDX_zalip_chat_message_from_to_id', ['fromUserId', 'toUserId', 'id'], { where: '"toRoomId" IS NULL' })
@Index('IDX_zalip_chat_message_to_from_id', ['toUserId', 'fromUserId', 'id'], { where: '"toRoomId" IS NULL' })
@Index('IDX_zalip_chat_message_room_id', ['toRoomId', 'id'], { where: '"toRoomId" IS NOT NULL' })
export class MiChatMessage {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column({
		...id(),
	})
	public fromUserId: MiUser['id'];

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public fromUser: MiUser | null;

	@Index()
	@Column({
		...id(), nullable: true,
	})
	public toUserId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public toUser: MiUser | null;

	@Index()
	@Column({
		...id(), nullable: true,
	})
	public toRoomId: MiChatRoom['id'] | null;

	@ManyToOne(() => MiChatRoom, {
		onDelete: 'CASCADE',
	})
	@JoinColumn()
	public toRoom: MiChatRoom | null;

	@Column('varchar', {
		length: 4096, nullable: true,
	})
	public text: string | null;

	@Column('timestamp with time zone', { nullable: true })
	public updatedAt: Date | null;

	@Index('IDX_chat_message_reply')
	@Column({ ...id(), nullable: true })
	public replyId: MiChatMessage['id'] | null;

	@ManyToOne(() => MiChatMessage, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'replyId', foreignKeyConstraintName: 'FK_chat_message_reply' })
	public reply: MiChatMessage | null;

	@Column({ ...id(), nullable: true })
	public forwardedFromUserId: MiUser['id'] | null;

	@ManyToOne(() => MiUser, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'forwardedFromUserId', foreignKeyConstraintName: 'FK_chat_message_forwarded_user' })
	public forwardedFromUser: MiUser | null;

	@Column('varchar', {
		length: 512, nullable: true,
	})
	public uri: string | null;

	@Column({
		...id(),
		array: true, default: '{}',
	})
	public reads: MiUser['id'][];

	@Column({
		...id(),
		nullable: true,
	})
	public fileId: MiDriveFile['id'] | null;

	@ManyToOne(() => MiDriveFile, {
		onDelete: 'SET NULL',
	})
	@JoinColumn()
	public file: MiDriveFile | null;

	@Column('varchar', {
		length: 1024, array: true, default: '{}',
	})
	public reactions: string[];
}
