/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { ImportSource } from '@/core/zalip-importer/types.js';

export type EncryptedImporterTokens = { version: 1; nonce: string; tag: string; ciphertext: string };

@Entity('zalip_importer_source_setting')
export class MiZalipImporterSourceSetting {
	@PrimaryColumn('varchar', { length: 16, primaryKeyConstraintName: 'PK_zalip_importer_source_setting' }) public source: ImportSource;
	@Column('varchar', { length: 1024 }) public apiOrigin: string;
	@Column('varchar', { length: 1024, nullable: true }) public playerOrigin: string | null;
	/** Only authenticated ciphertext is stored; never a raw API key or iframe token. */
	@Column('jsonb', { nullable: true }) public encryptedTokens: EncryptedImporterTokens | null;
	@Column('timestamp with time zone') public updatedAt: Date;
}
