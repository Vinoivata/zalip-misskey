/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import type { MaintenanceCursor, MaintenanceKind, MaintenanceOptions, MaintenanceSource, MaintenanceState, MaintenanceStats } from '@/core/zalip-importer/types.js';
import { id } from './util/id.js';

@Entity('zalip_maintenance_profile')
@Index('IDX_zalip_maintenance_profile_due', ['enabled', 'nextRunAt'])
export class MiZalipMaintenanceProfile {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_maintenance_profile' }) public id: string;
	@Column('timestamp with time zone') public createdAt: Date;
	@Column('timestamp with time zone') public updatedAt: Date;
	@Column('varchar', { length: 120 }) public name: string;
	@Column('varchar', { length: 32 }) public kind: MaintenanceKind;
	@Column('varchar', { length: 16 }) public source: MaintenanceSource;
	@Column('boolean', { default: false }) public enabled: boolean;
	@Column('integer', { default: 1440 }) public intervalMinutes: number;
	@Column('integer', { default: 20 }) public batchLimit: number;
	@Column('integer', { default: 60 }) public timeBudgetSeconds: number;
	@Column('jsonb', { default: {} }) public options: MaintenanceOptions;
	@Column('jsonb', { default: { page: 1, offset: 0, entryAfterId: null, activeEntryId: null, collectionIndex: 0 } }) public cursor: MaintenanceCursor;
	@Column('timestamp with time zone', { nullable: true }) public lastRunAt: Date | null;
	@Column('timestamp with time zone', { nullable: true }) public nextRunAt: Date | null;
	@Column('varchar', { length: 128, nullable: true }) public lastError: string | null;
}

@Entity('zalip_maintenance_run')
@Index('IDX_zalip_maintenance_run_state_updated', ['state', 'updatedAt'])
@Index('IDX_zalip_maintenance_run_profile_state', ['profileId', 'state'])
export class MiZalipMaintenanceRun {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_maintenance_run' }) public id: string;
	@Column('timestamp with time zone') public createdAt: Date;
	@Column('timestamp with time zone') public updatedAt: Date;
	@Column('timestamp with time zone', { nullable: true }) public finishedAt: Date | null;
	@Column({ ...id(), nullable: true }) public createdById: string | null;
	@Column({ ...id(), nullable: true }) public profileId: string | null;
	@ManyToOne(() => MiZalipMaintenanceProfile, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'profileId', foreignKeyConstraintName: 'FK_zalip_maintenance_run_profile' }) public profile: MiZalipMaintenanceProfile | null;
	@Column('varchar', { length: 32 }) public kind: MaintenanceKind;
	@Column('varchar', { length: 16 }) public source: MaintenanceSource;
	@Column('varchar', { length: 16, default: 'queued' }) public state: MaintenanceState;
	@Column('integer', { default: 20 }) public batchLimit: number;
	@Column('integer', { default: 60 }) public timeBudgetSeconds: number;
	@Column('jsonb', { default: {} }) public options: MaintenanceOptions;
	@Column('jsonb', { default: { page: 1, offset: 0, entryAfterId: null, activeEntryId: null, collectionIndex: 0 } }) public cursor: MaintenanceCursor;
	@Column('jsonb', { default: { processed: 0, created: 0, updated: 0, linked: 0, skipped: 0, failed: 0 } }) public stats: MaintenanceStats;
	@Column('jsonb', { default: [] }) public warnings: string[];
	@Column('varchar', { length: 128, nullable: true }) public error: string | null;
	@Column('timestamp with time zone', { nullable: true }) public retryAfter: Date | null;
}
