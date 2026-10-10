/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { id } from './util/id.js';
import { MiNote } from './Note.js';
import { MiUser } from './User.js';
import { MiZalipEpisode } from './ZalipEpisode.js';

/**
 * Connects one catalogue episode to one ordinary local Misskey root note.
 * Replies, reactions, reports and notifications remain native Note behaviour.
 */
@Entity('zalip_episode_note_context')
@Unique('UQ_zalip_episode_note_context_note', ['noteId'])
export class MiZalipEpisodeNoteContext {
	/** The canonical Zalip episode ID. */
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_episode_note_context' })
	public episodeId: MiZalipEpisode['id'];

	@ManyToOne(() => MiZalipEpisode, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'episodeId', foreignKeyConstraintName: 'FK_zalip_episode_note_context_episode' })
	public episode: MiZalipEpisode | null;

	/** The linked local Misskey root note ID. */
	@Column(id())
	public noteId: MiNote['id'];

	@ManyToOne(() => MiNote, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'noteId', foreignKeyConstraintName: 'FK_zalip_episode_note_context_note' })
	public note: MiNote | null;

	/** The Misskey administrator who created the link. */
	@Column(id())
	public createdById: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'createdById', foreignKeyConstraintName: 'FK_zalip_episode_note_context_creator' })
	public createdBy: MiUser | null;

	@Column('timestamp with time zone')
	public createdAt: Date;
}
