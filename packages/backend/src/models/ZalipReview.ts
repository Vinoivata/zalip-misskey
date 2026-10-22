/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn, Unique } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiZalipWork } from './ZalipWork.js';

export const zalipReviewFormats = ['review', 'essay'] as const;
export type ZalipReviewFormat = typeof zalipReviewFormats[number];
export const zalipReviewSentiments = ['positive', 'neutral', 'negative'] as const;
export type ZalipReviewSentiment = typeof zalipReviewSentiments[number];

/** A public opinion belongs to its real author and canonical title, not the importer account. */
@Entity('zalip_review')
@Unique('UQ_zalip_review_user_work_format', ['userId', 'workId', 'format'])
@Index('IDX_zalip_review_work_deleted_created', ['workId', 'deletedAt', 'createdAt'])
@Check('CHK_zalip_review_format', '"format" IN (\'review\', \'essay\')')
@Check('CHK_zalip_review_sentiment', '"sentiment" IN (\'positive\', \'neutral\', \'negative\')')
@Check('CHK_zalip_review_body', 'char_length(btrim("body")) BETWEEN 20 AND 12000')
@Check('CHK_zalip_review_title', '"format" <> \'essay\' OR ("title" IS NOT NULL AND char_length(btrim("title")) BETWEEN 1 AND 200)')
export class MiZalipReview {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_review' })
	public id: string;

	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_zalip_review_user' })
	public user: MiUser | null;

	@Column(id())
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_review_work' })
	public work: MiZalipWork | null;

	@Column('varchar', { length: 16 })
	public format: ZalipReviewFormat;

	@Column('varchar', { length: 200, nullable: true })
	public title: string | null;

	@Column('varchar', { length: 12000 })
	public body: string;

	@Column('boolean', { default: false })
	public isSpoiler: boolean;

	@Column('varchar', { length: 16 })
	public sentiment: ZalipReviewSentiment;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;

	/** Soft removal retains the opinion and original timestamps for recovery. */
	@Column('timestamp with time zone', { nullable: true })
	public deletedAt: Date | null;

	@Column({ ...id(), nullable: true })
	public deletedById: MiUser['id'] | null;

	@ManyToOne(() => MiUser, { onDelete: 'SET NULL' })
	@JoinColumn({ name: 'deletedById', foreignKeyConstraintName: 'FK_zalip_review_deleted_by' })
	public deletedBy: MiUser | null;
}
