/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

export const zalipCatalogEntryTypes = ['person', 'studio', 'genre', 'category', 'collection'] as const;
export type ZalipCatalogEntryType = typeof zalipCatalogEntryTypes[number];

/** A shared catalogue directory, deliberately independent of Misskey user accounts. */
@Entity('zalip_catalog_entry')
@Index('IDX_zalip_catalog_entry_type_slug', ['type', 'slug'], { unique: true })
@Index('IDX_zalip_catalog_entry_type_name', ['type', 'name'])
@Index('IDX_zalip_catalog_entry_parent', ['parentId'])
export class MiZalipCatalogEntry {
	@PrimaryColumn({ ...id(), primaryKeyConstraintName: 'PK_zalip_catalog_entry' })
	public id: string;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;

	@Column('varchar', { length: 16 })
	public type: ZalipCatalogEntryType;

	@Column('varchar', { length: 160 })
	public slug: string;

	@Column('varchar', { length: 256 })
	public name: string;

	@Column('varchar', { length: 8192, nullable: true })
	public description: string | null;

	@Column('varchar', { length: 1024, nullable: true })
	public imageUrl: string | null;

	/** Namespaced provider IDs, not credentials or complete provider responses. */
	@Column('jsonb', { default: {} })
	public externalIds: Record<string, string>;

	/** Public facts plus private _zalip editorial ownership information, stripped when packed. */
	@Column('jsonb', { default: {} })
	public data: Record<string, unknown>;

	@Column({ ...id(), nullable: true })
	public parentId: MiZalipCatalogEntry['id'] | null;

	@ManyToOne(() => MiZalipCatalogEntry, { onDelete: 'SET NULL', nullable: true })
	@JoinColumn({ name: 'parentId', foreignKeyConstraintName: 'FK_zalip_catalog_entry_parent' })
	public parent: MiZalipCatalogEntry | null;
}
