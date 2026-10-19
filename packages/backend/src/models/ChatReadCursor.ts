/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';

/** Per-reader high-water frontier. It deliberately survives deletion of the read message. */
@Entity('chat_read_cursor')
@Check('CHK_chat_read_cursor_key', '"conversationKey" ~ \'^(user|room):[A-Za-z0-9]{1,32}$\'')
export class MiChatReadCursor {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_chat_read_cursor' })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_chat_read_cursor_user' })
	public user: MiUser | null;

	@PrimaryColumn('varchar', { length: 64, primaryKeyConstraintName: 'PK_chat_read_cursor' })
	public conversationKey: string;

	// No message FK: removing a message cannot turn already read history into new messages.
	@Column('varchar', { length: 32 })
	public readThroughId: string;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
