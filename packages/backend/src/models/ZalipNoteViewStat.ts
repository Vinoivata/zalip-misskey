/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { MiNote } from './Note.js';
import { id } from './util/id.js';

/** Aggregate only: viewer identities, IP addresses and view history are never stored here. */
@Entity('zalip_note_view_stat')
@Check('CHK_zalip_note_view_count', '"count" >= 0 AND "count" <= 9007199254740991')
export class MiZalipNoteViewStat {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_note_view_stat' })
	public noteId: MiNote['id'];

	@ManyToOne(() => MiNote, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'noteId', foreignKeyConstraintName: 'FK_zalip_note_view_stat_note' })
	public note: MiNote | null;

	// PostgreSQL bigint stays a string until the bounded public projection converts it.
	@Column('bigint', { default: 0 })
	public count: string;
}
