/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipWork } from './ZalipWork.js';

/**
 * Durable outbox row for a film or episode that first appeared in Alloha.
 * availabilityKey is never nullable so a unique index deduplicates films as well as episodes.
 */
@Entity('zalip_alloha_availability_event')
@Index(['workId', 'availabilityKey'], { unique: true })
@Index(['createdAt'])
export class MiZalipAllohaAvailabilityEvent {
	@PrimaryColumn(id())
	public id: string;

	@Column({ ...id(), comment: 'The canonical Zalip work ID.' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId' })
	public work: MiZalipWork | null;

	@Column('varchar', { length: 64 })
	public availabilityKey: string;

	@Column('integer', { nullable: true })
	public seasonNumber: number | null;

	@Column('integer', { nullable: true })
	public episodeNumber: number | null;

	@Column('integer', { default: 0 })
	public translationCount: number;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone', { nullable: true })
	public notificationDeliveredAt: Date | null;
}
