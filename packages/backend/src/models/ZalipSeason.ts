/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipWork } from './ZalipWork.js';

@Entity('zalip_season')
@Index(['workId', 'seasonNumber'], { unique: true })
export class MiZalipSeason {
	@PrimaryColumn(id())
	public id: string;

	@Column({ ...id(), comment: 'The parent canonical Zalip work ID.' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId' })
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
}
