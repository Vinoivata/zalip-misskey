/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';
import { MiZalipCatalogEntry } from './ZalipCatalogEntry.js';
import { MiZalipWork } from './ZalipWork.js';

/** Manual links and provider links coexist; an import can only replace its own links. */
@Entity('zalip_catalog_relation')
@Index('IDX_zalip_catalog_relation_identity', ['entryId', 'workId', 'role', 'source'], { unique: true })
@Index('IDX_zalip_catalog_relation_work', ['workId'])
@Index('IDX_zalip_catalog_relation_entry', ['entryId'])
@Check('CHK_zalip_catalog_relation_position', '"position" >= 0')
export class MiZalipCatalogRelation {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_catalog_relation' })
	public id: string;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;

	@Column(id())
	public entryId: MiZalipCatalogEntry['id'];

	@ManyToOne(() => MiZalipCatalogEntry, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'entryId', foreignKeyConstraintName: 'FK_zalip_catalog_relation_entry' })
	public entry: MiZalipCatalogEntry | null;

	@Column(id())
	public workId: MiZalipWork['id'];

	@ManyToOne(() => MiZalipWork, { onDelete: 'CASCADE' })
	@JoinColumn({ name: 'workId', foreignKeyConstraintName: 'FK_zalip_catalog_relation_work' })
	public work: MiZalipWork | null;

	@Column('varchar', { length: 64, default: '' })
	public role: string;

	@Column('varchar', { length: 256, nullable: true })
	public character: string | null;

	@Column('integer', { default: 0 })
	public position: number;

	@Column('varchar', { length: 32, default: 'manual' })
	public source: string;
}
