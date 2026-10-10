/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipSeason } from './ZalipSeason.js';

/** Canonical episode metadata. Provider availability is intentionally a separate future mapping. */
@Entity('zalip_episode')
@Unique('UQ_zalip_episode_season_number', ['seasonId', 'episodeNumber'])
@Check('CHK_zalip_episode_number', '"episodeNumber" >= 0')
@Check('CHK_zalip_episode_runtime', '"runtimeMinutes" IS NULL OR "runtimeMinutes" > 0')
export class MiZalipEpisode {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_episode' })
	public id: string;

	/** Optional stable TMDB episode identifier; never exposed as a playback provider ID. */
	@Column('integer', { nullable: true })
	public tmdbEpisodeId: number | null;

	/** The parent canonical Zalip season ID. */
	@Column(id())
	public seasonId: MiZalipSeason['id'];

	@ManyToOne(() => MiZalipSeason, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'seasonId', foreignKeyConstraintName: 'FK_zalip_episode_season' })
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

	@Column('jsonb', { default: {} })
	public importValues: Record<string, unknown>;
}
