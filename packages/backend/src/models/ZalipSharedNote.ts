/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiNote } from './Note.js';
import { MiZalipWork } from './ZalipWork.js';

/**
 * A normal local Misskey note that carries a canonical Zalip title card.
 * The note owns reactions, replies, renotes and moderation; this relation only supplies UI context.
 */
@Entity('zalip_shared_note')
@Index('IDX_zalip_shared_note_work_created', ['workId', 'createdAt'])
export class MiZalipSharedNote {
	/** The ordinary local Misskey note ID. */
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_shared_note_note' })
	public noteId: MiNote['id'];

	@ManyToOne(() => MiNote, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'noteId', foreignKeyConstraintName: 'FK_zalip_shared_note_note' })
	public note: MiNote | null;

	/** The canonical published Zalip work ID. */
	@Column(id())
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_shared_note_work' })
	public work: MiZalipWork | null;

	@Column('timestamp with time zone')
	public createdAt: Date;
}
