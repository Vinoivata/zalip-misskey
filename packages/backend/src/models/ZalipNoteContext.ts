/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { id } from './util/id.js';
import { MiNote } from './Note.js';
import { MiUser } from './User.js';
import { MiZalipWork } from './ZalipWork.js';

/**
 * Connects one catalogue title to one ordinary local Misskey root note.
 * Replies, reactions, reports and notifications deliberately remain on the Note itself.
 */
@Entity('zalip_note_context')
@Unique('UQ_zalip_note_context_note', ['noteId'])
export class MiZalipNoteContext {
	/** The canonical Zalip work ID. */
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_note_context' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_note_context_work' })
	public work: MiZalipWork | null;

	/** The linked local Misskey root note ID. */
	@Column(id())
	public noteId: MiNote['id'];

	@ManyToOne(() => MiNote, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'noteId', foreignKeyConstraintName: 'FK_zalip_note_context_note' })
	public note: MiNote | null;

	/** The Misskey administrator who created the link. */
	@Column(id())
	public createdById: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'createdById', foreignKeyConstraintName: 'FK_zalip_note_context_creator' })
	public createdBy: MiUser | null;

	@Column('timestamp with time zone')
	public createdAt: Date;
}
