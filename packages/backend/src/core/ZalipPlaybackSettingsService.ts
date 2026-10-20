/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { MiZalipPlaybackSettings } from '@/models/ZalipPlaybackSettings.js';
import { defaultPlaybackSettings, normalizePlaybackSettings } from './zalip-importer/playback-settings.js';

@Injectable()
export class ZalipPlaybackSettingsService {
	constructor(@Inject(DI.db) private db: DataSource) {}

	public async show() {
		const row = await this.db.getRepository(MiZalipPlaybackSettings).findOneBy({ id: 'default' });
		let providers = defaultPlaybackSettings();
		if (row) {
			try { providers = normalizePlaybackSettings(row.providers); } catch { /* Invalid legacy settings use documented defaults. */ }
		}
		return { providers };
	}

	public async save(value: unknown) {
		// Legacy rows are upgraded on read only; old clients must not reset new providers' policies.
		if (!Array.isArray(value) || value.length !== 4) throw new Error('INVALID_PLAYBACK_SETTINGS');
		const providers = normalizePlaybackSettings(value);
		await this.db.getRepository(MiZalipPlaybackSettings).upsert({ id: 'default', providers, updatedAt: new Date() }, ['id']);
		return { providers };
	}
}
