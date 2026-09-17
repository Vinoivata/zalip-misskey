/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipWork } from './ZalipWork.js';
import { MiZalipSeason } from './ZalipSeason.js';
import { MiZalipEpisode } from './ZalipEpisode.js';

/** One immutable catalogue event for an episode first discovered after a known season baseline. */
@Entity('zalip_release_event')
@Index(['episodeId'], { unique: true })
@Index(['workId', 'createdAt'])
export class MiZalipReleaseEvent {
	@PrimaryColumn(id())
	public id: string;

	@Column({ ...id(), comment: 'The canonical Zalip work ID.' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId' })
	public work: MiZalipWork | null;

	@Column({ ...id(), comment: 'The parent canonical Zalip season ID.' })
	public seasonId: MiZalipSeason['id'];

	@ManyToOne(() => MiZalipSeason, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'seasonId' })
	public season: MiZalipSeason | null;

	@Column({ ...id(), comment: 'The canonical Zalip episode ID.' })
	public episodeId: MiZalipEpisode['id'];

	@ManyToOne(() => MiZalipEpisode, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'episodeId' })
	public episode: MiZalipEpisode | null;

	@Column('timestamp with time zone')
	public createdAt: Date;
}
