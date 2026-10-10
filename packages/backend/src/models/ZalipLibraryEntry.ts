/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiZalipWork } from './ZalipWork.js';

export const zalipLibraryStatuses = ['watching', 'planned', 'completed', 'on_hold', 'dropped'] as const;
export type ZalipLibraryStatus = typeof zalipLibraryStatuses[number];

/** Personal state belongs directly to the signed-in Misskey user, never to a copied account. */
@Entity('zalip_library_entry')
@Index('IDX_zalip_library_user_status_updated', ['userId', 'status', 'updatedAt'])
@Index('IDX_zalip_library_user_release_subscription', ['userId', 'isReleaseSubscribed'])
@Check('CHK_zalip_library_status', '"status" IN (\'watching\', \'planned\', \'completed\', \'on_hold\', \'dropped\')')
@Check('CHK_zalip_library_episodes', '"episodesWatched" >= 0')
@Check('CHK_zalip_library_rating', '"personalRating" IS NULL OR ("personalRating" >= 1 AND "personalRating" <= 10)')
export class MiZalipLibraryEntry {
	/** The owner Misskey user ID. */
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_library_entry' })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_zalip_library_user' })
	public user: MiUser | null;

	/** The canonical Zalip work ID. */
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_library_entry' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_library_work' })
	public work: MiZalipWork | null;

	@Column('varchar', { length: 16, nullable: true })
	public status: ZalipLibraryStatus | null;

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
