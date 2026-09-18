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
@Index(['workId', 'createdAt'])
export class MiZalipSharedNote {
	@PrimaryColumn({ ...id(), comment: 'The ordinary local Misskey note ID.' })
	public noteId: MiNote['id'];

	@ManyToOne(() => MiNote, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'noteId' })
	public note: MiNote | null;

	@Column({ ...id(), comment: 'The canonical published Zalip work ID.' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId' })
	public work: MiZalipWork | null;

	@Column('timestamp with time zone')
	public createdAt: Date;
}
