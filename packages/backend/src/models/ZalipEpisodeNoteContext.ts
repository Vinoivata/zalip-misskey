/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiNote } from './Note.js';
import { MiUser } from './User.js';
import { MiZalipEpisode } from './ZalipEpisode.js';

/**
 * Connects one catalogue episode to one ordinary local Misskey root note.
 * Replies, reactions, reports and notifications remain native Note behaviour.
 */
@Entity('zalip_episode_note_context')
export class MiZalipEpisodeNoteContext {
	@PrimaryColumn({ ...id(), comment: 'The canonical Zalip episode ID.' })
	public episodeId: MiZalipEpisode['id'];

	@ManyToOne(() => MiZalipEpisode, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'episodeId' })
	public episode: MiZalipEpisode | null;

	@Index({ unique: true })
	@Column({ ...id(), comment: 'The linked local Misskey root note ID.' })
	public noteId: MiNote['id'];

	@ManyToOne(() => MiNote, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'noteId' })
	public note: MiNote | null;

	@Column({ ...id(), comment: 'The Misskey administrator who created the link.' })
	public createdById: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'createdById' })
	public createdBy: MiUser | null;

	@Column('timestamp with time zone')
	public createdAt: Date;
}
