/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipWork } from './ZalipWork.js';

@Entity('zalip_season')
@Unique('UQ_zalip_season_work_number', ['workId', 'seasonNumber'])
@Check('CHK_zalip_season_number', '"seasonNumber" >= 0')
@Check('CHK_zalip_season_episode_count', '"episodeCount" IS NULL OR "episodeCount" >= 0')
export class MiZalipSeason {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_season' })
	public id: string;

	/** The parent canonical Zalip work ID. */
	@Column(id())
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_season_work' })
	public work: MiZalipWork | null;

	@Column('integer')
	public seasonNumber: number;

	@Column('varchar', { length: 256 })
	public title: string;

	@Column('varchar', { length: 256, nullable: true })
	public originalTitle: string | null;

	@Column('varchar', { length: 8192, nullable: true })
	public description: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public posterPath: string | null;

	/** ISO date from the metadata source; storing it as text avoids timezone conversion. */
	@Column('varchar', { length: 10, nullable: true })
	public airDate: string | null;

	@Column('integer', { nullable: true })
	public episodeCount: number | null;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;

	@Column('jsonb', { default: {} })
	public importValues: Record<string, unknown>;
}
