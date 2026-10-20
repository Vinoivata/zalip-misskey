/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiUser } from './User.js';
import { MiZalipWork } from './ZalipWork.js';
import { MiZalipEpisode } from './ZalipEpisode.js';

export const zalipProgressProviders = ['alloha', 'collaps', 'kodik', 'vibix'] as const;
export type ZalipProgressProvider = typeof zalipProgressProviders[number];
export const zalipProgressMaxSeconds = 48 * 60 * 60;

/** Private latest playback target. Never packed as part of a public work or importer snapshot. */
@Entity('zalip_watch_progress')
@Index('IDX_zalip_progress_user_played_work', ['userId', 'lastPlayedAt', 'workId'])
@Check('CHK_zalip_progress_provider', '("provider")::text = ANY (ARRAY[(\'alloha\'::character varying)::text, (\'collaps\'::character varying)::text, (\'kodik\'::character varying)::text, (\'vibix\'::character varying)::text])')
@Check('CHK_zalip_progress_mode', '"mode" IN (\'time\', \'episode\')')
@Check('CHK_zalip_progress_sequence', '"sequence" >= 0')
@Check('CHK_zalip_progress_duration', '"durationSeconds" IS NULL OR ("durationSeconds" > 0 AND "durationSeconds" <= 172800)')
@Check('CHK_zalip_progress_position', '"positionSeconds" IS NULL OR ("durationSeconds" IS NOT NULL AND "positionSeconds" >= 0 AND "positionSeconds" <= "durationSeconds")')
@Check('CHK_zalip_progress_time_provider', '("mode" = \'time\' AND "provider" IN (\'alloha\', \'collaps\', \'kodik\')) OR ("mode" = \'episode\' AND "positionSeconds" IS NULL AND "durationSeconds" IS NULL)')
export class MiZalipWatchProgress {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_watch_progress' })
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'userId', foreignKeyConstraintName: 'FK_zalip_progress_user' })
	public user: MiUser | null;

	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_watch_progress' })
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_progress_work' })
	public work: MiZalipWork | null;

	/** Null is only a single film, never a missing/unknown series episode. */
	@Column({ ...id(), nullable: true })
	public episodeId: MiZalipEpisode['id'] | null;

	// Removing an episode removes its resume target instead of turning it into a film.
	@ManyToOne(() => MiZalipEpisode, { onDelete: 'CASCADE', nullable: true })
	@JoinColumn({ name: 'episodeId', foreignKeyConstraintName: 'FK_zalip_progress_episode' })
	public episode: MiZalipEpisode | null;

	@Column('varchar', { length: 16 }) public provider: ZalipProgressProvider;
	@Column('varchar', { length: 16 }) public mode: 'time' | 'episode';
	@Column('varchar', { length: 100, nullable: true }) public translationId: string | null;
	/** Resource identity (opaque media fingerprint for verified timelines), never an iframe URL or credential. */
	@Column('varchar', { length: 100 }) public resourceId: string;
	@Column('double precision', { nullable: true }) public positionSeconds: number | null;
	@Column('double precision', { nullable: true }) public durationSeconds: number | null;
	@Column('boolean', { default: false }) public completed: boolean;
	@Column('boolean', { default: false }) public hidden: boolean;
	@Column('uuid') public sessionId: string;
	@Column('integer', { default: 0 }) public sequence: number;
	@Column('timestamp with time zone') public lastPlayedAt: Date;
	@Column('timestamp with time zone') public createdAt: Date;
}
