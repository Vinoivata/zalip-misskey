/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import type { ImportSource } from '@/core/zalip-importer/types.js';

@Entity('zalip_import_profile')
@Index('IDX_zalip_import_profile_next', ['enabled', 'nextRunAt'])
export class MiZalipImportProfile {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_import_profile' }) public id: string;
	@Column('varchar', { length: 120 }) public name: string;
	@Column('boolean', { default: false }) public enabled: boolean;
	@Column('varchar', { length: 16 }) public source: ImportSource;
	@Column('varchar', { length: 16 }) public mode: 'metadata' | 'availability' | 'collection';
	@Column('integer', { default: 1440 }) public intervalMinutes: number;
	@Column('varchar', { length: 100, nullable: true }) public collectionId: string | null;
	@Column('jsonb', { default: [] }) public lockedFields: string[];
	@Column('jsonb', { default: [] }) public categoryIds: string[];
	@Column('timestamp with time zone', { nullable: true }) public lastRunAt: Date | null;
	@Column('timestamp with time zone', { nullable: true }) public nextRunAt: Date | null;
	@Column('varchar', { length: 128, nullable: true }) public lastError: string | null;
	@Column('integer', { default: 0 }) public cursor: number;
}
