/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipSeason } from './ZalipSeason.js';

/** Canonical episode metadata. Provider availability is intentionally a separate future mapping. */
@Entity('zalip_episode')
@Index(['seasonId', 'episodeNumber'], { unique: true })
export class MiZalipEpisode {
	@PrimaryColumn(id())
	public id: string;

	/** Optional stable TMDB episode identifier; never exposed as a playback provider ID. */
	@Column('integer', { nullable: true })
	public tmdbEpisodeId: number | null;

	@Column({ ...id(), comment: 'The parent canonical Zalip season ID.' })
	public seasonId: MiZalipSeason['id'];

	@ManyToOne(() => MiZalipSeason, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'seasonId' })
	public season: MiZalipSeason | null;

	@Column('integer')
	public episodeNumber: number;

	@Column('varchar', { length: 256 })
	public title: string;

	@Column('varchar', { length: 256, nullable: true })
	public originalTitle: string | null;

	@Column('varchar', { length: 8192, nullable: true })
	public description: string | null;

	@Column('varchar', { length: 10, nullable: true })
	public airDate: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public stillPath: string | null;

	@Column('integer', { nullable: true })
	public runtimeMinutes: number | null;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
