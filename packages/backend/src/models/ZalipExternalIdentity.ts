/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipWork } from './ZalipWork.js';
import type { ImportRecord } from '@/core/zalip-importer/types.js';

@Entity('zalip_external_identity')
@Index('IDX_zalip_external_identity_key', ['provider', 'entityType', 'externalId'], { unique: true })
@Index('IDX_zalip_external_identity_work', ['workId'])
export class MiZalipExternalIdentity {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_external_identity' }) public id: string;
	@Column(id()) public workId: string;
	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_external_identity_work' }) public work: MiZalipWork | null;
	@Column('varchar', { length: 16 }) public provider: string;
	@Column('varchar', { length: 16 }) public entityType: 'movie' | 'tv';
	@Column('varchar', { length: 100 }) public externalId: string;
	@Column('jsonb', { nullable: true }) public snapshot: ImportRecord | null;
	@Column('timestamp with time zone') public updatedAt: Date;
}
