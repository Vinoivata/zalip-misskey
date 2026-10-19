/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiZalipReview } from './ZalipReview.js';

export type ZalipReviewVoteValue = 'helpful' | 'unhelpful';

/** Helpfulness is separate from the single personal title rating in the library. */
@Entity('zalip_review_vote')
@Index('IDX_zalip_review_vote_review_value', ['reviewId', 'value'])
@Check('CHK_zalip_review_vote_value', '"value" IN (\'helpful\', \'unhelpful\')')
export class MiZalipReviewVote {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_review_vote' })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_zalip_review_vote_user' })
	public user: MiUser | null;

	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_review_vote' })
	public reviewId: MiZalipReview['id'];

	@ManyToOne(() => MiZalipReview, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'reviewId', foreignKeyConstraintName: 'FK_zalip_review_vote_review' })
	public review: MiZalipReview | null;

	@Column('varchar', { length: 16 })
	public value: ZalipReviewVoteValue;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;
}
