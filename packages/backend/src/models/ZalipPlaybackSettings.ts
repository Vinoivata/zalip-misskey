/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { ZalipPlaybackProviderSetting } from '@/core/zalip-importer/playback-settings.js';

@Entity('zalip_playback_settings')
export class MiZalipPlaybackSettings {
	@PrimaryColumn('varchar', { length: 16, primaryKeyConstraintName: 'PK_zalip_playback_settings' }) public id: string;
	@Column('jsonb', { default: [] }) public providers: ZalipPlaybackProviderSetting[];
	@Column('timestamp with time zone') public updatedAt: Date;
}
