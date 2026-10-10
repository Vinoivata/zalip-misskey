/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipWork } from './ZalipWork.js';
import { MiZalipSeason } from './ZalipSeason.js';
import { MiZalipEpisode } from './ZalipEpisode.js';

/** One immutable catalogue event for an episode first discovered after a known season baseline. */
@Entity('zalip_release_event')
@Unique('UQ_zalip_release_event_episode', ['episodeId'])
@Index('IDX_zalip_release_event_work_created', ['workId', 'createdAt'])
export class MiZalipReleaseEvent {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_release_event' })
	public id: string;

	/** The canonical Zalip work ID. */
	@Column(id())
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_release_event_work' })
	public work: MiZalipWork | null;

	/** The parent canonical Zalip season ID. */
	@Column(id())
	public seasonId: MiZalipSeason['id'];

	@ManyToOne(() => MiZalipSeason, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'seasonId', foreignKeyConstraintName: 'FK_zalip_release_event_season' })
	public season: MiZalipSeason | null;

	/** The canonical Zalip episode ID. */
	@Column(id())
	public episodeId: MiZalipEpisode['id'];

	@ManyToOne(() => MiZalipEpisode, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'episodeId', foreignKeyConstraintName: 'FK_zalip_release_event_episode' })
	public episode: MiZalipEpisode | null;

	@Column('timestamp with time zone')
	public createdAt: Date;

	/**
	 * Set after every current subscriber has received the native Misskey notification.
	 * This durable outbox marker keeps a transient Redis/Web Push failure from being
	 * mistaken for a successfully delivered release alert.
	 */
	@Column('timestamp with time zone', { nullable: true })
	public notificationDeliveredAt: Date | null;
}
