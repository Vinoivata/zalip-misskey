/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipWork } from './ZalipWork.js';

/** A deliberately small, validated subset of a provider translation response. */
export type ZalipAllohaTranslation = {
	id: number;
	name: string;
	quality: string | null;
	resolutions: string[];
	iframe: string;
};

/**
 * Cached Alloha playback information for a canonical work.
 *
 * The API credential and provider response token never enter this table. Iframe URLs are
 * accepted only after host validation in ZalipAllohaService, and are returned solely to
 * authenticated Zalip users who explicitly open the player.
 */
@Entity('zalip_alloha_source')
@Index(['workId'], { unique: true })
export class MiZalipAllohaSource {
	@PrimaryColumn(id())
	public id: string;

	@Column({ ...id(), comment: 'The canonical Zalip work ID.' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId' })
	public work: MiZalipWork | null;

	@Column('varchar', { length: 24 })
	public category: string;

	@Column('boolean', { default: false })
	public isAvailable: boolean;

	@Column('varchar', { length: 2048, nullable: true })
	public iframe: string | null;

	@Column('jsonb', { default: () => "'[]'::jsonb" })
	public translations: ZalipAllohaTranslation[];

	@Column('timestamp with time zone')
	public lastCheckedAt: Date;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
