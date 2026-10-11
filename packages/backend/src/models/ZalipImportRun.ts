/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import type { ImportOptions, ImportRef } from '@/core/zalip-importer/types.js';

@Entity('zalip_import_run')
@Index('IDX_zalip_import_run_state_updated', ['state', 'updatedAt'])
export class MiZalipImportRun {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_import_run' }) public id: string;
	@Column('timestamp with time zone') public createdAt: Date;
	@Column('timestamp with time zone') public updatedAt: Date;
	@Column({ ...id(), nullable: true }) public createdById: string | null;
	@Column({ ...id(), nullable: true }) public profileId: string | null;
	@Column('varchar', { length: 16 }) public mode: 'import' | 'sync' | 'availability';
	@Column('varchar', { length: 16, default: 'queued' }) public state: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
	@Column('jsonb', { default: [] }) public lockedFields: string[];
	@Column('jsonb', { default: [] }) public categoryIds: string[];
	@Column('jsonb', { default: {} }) public options: ImportOptions;
	@Column('varchar', { length: 128, nullable: true }) public error: string | null;
	@Column('timestamp with time zone', { nullable: true }) public retryAt: Date | null;
}

@Entity('zalip_import_item')
@Index('IDX_zalip_import_item_run_position', ['runId', 'position'], { unique: true })
export class MiZalipImportItem {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_import_item' }) public id: string;
	@Column(id()) public runId: string;
	@ManyToOne(() => MiZalipImportRun, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'runId', foreignKeyConstraintName: 'FK_zalip_import_item_run' }) public run: MiZalipImportRun | null;
	@Column('integer') public position: number;
	@Column('varchar', { length: 16, default: 'pending' }) public state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
	@Column('jsonb') public ref: ImportRef;
	@Column({ ...id(), nullable: true }) public workId: string | null;
	@Column('varchar', { length: 128, nullable: true }) public error: string | null;
	@Column('jsonb', { default: [] }) public warnings: string[];
	@Column('timestamp with time zone') public updatedAt: Date;
}
