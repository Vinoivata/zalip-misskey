/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiZalipWork } from './ZalipWork.js';

export const zalipLibraryStatuses = ['watching', 'planned', 'completed', 'on_hold', 'dropped'] as const;
export type ZalipLibraryStatus = typeof zalipLibraryStatuses[number];

/** Personal state belongs directly to the signed-in Misskey user, never to a copied account. */
@Entity('zalip_library_entry')
@Index(['userId', 'status', 'updatedAt'])
export class MiZalipLibraryEntry {
	@PrimaryColumn({ ...id(), comment: 'The owner Misskey user ID.' })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public user: MiUser | null;

	@PrimaryColumn({ ...id(), comment: 'The canonical Zalip work ID.' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn()
	public work: MiZalipWork | null;

	@Column('varchar', { length: 16, default: 'planned' })
	public status: ZalipLibraryStatus;

	@Column('integer', { default: 0 })
	public episodesWatched: number;

	@Column('integer', { nullable: true })
	public personalRating: number | null;

	@Column('boolean', { default: false })
	public isFavorite: boolean;

	/** Whether the owner wants this work included in their native Zalip updates feed. */
	@Column('boolean', { default: false })
	public isReleaseSubscribed: boolean;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
