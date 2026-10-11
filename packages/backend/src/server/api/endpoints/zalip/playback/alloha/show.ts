/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { ZalipPlaybackSettingsService } from '@/core/ZalipPlaybackSettingsService.js';
import { ZalipImporterSourceSettingsService } from '@/core/ZalipImporterSourceSettingsService.js';
import { configuredImportPlayerUrl } from '@/core/zalip-importer/providers.js';

export const meta = {
	tags: ['zalip', 'account'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'read:account',
	description: 'Returns cached, validated Alloha iframe choices for a published Zalip work after login.',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			label: { type: 'string' },
			available: { type: 'boolean' },
			iframe: { type: 'string', nullable: true },
			translations: {
				type: 'array',
				items: {
					type: 'object',
					properties: {
						id: { type: 'integer' },
						name: { type: 'string' },
						quality: { type: 'string', nullable: true },
						resolutions: { type: 'array', items: { type: 'string' } },
						iframe: { type: 'string' },
					},
					required: ['id', 'name', 'quality', 'resolutions', 'iframe'],
				},
			},
			lastCheckedAt: { type: 'string', nullable: true },
		},
		required: ['available', 'iframe', 'translations', 'lastCheckedAt', 'label'],
	},
	errors: {
		noSuchWork: {
			message: 'No such published Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: '80580871-32ed-4c6f-b516-07fa2b39f8b9',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		slug: { type: 'string', minLength: 1, maxLength: 160 },
	},
	required: ['slug'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private zalipCatalogService: ZalipCatalogService,
		private playbackSettings: ZalipPlaybackSettingsService,
		private sourceSettings: ZalipImporterSourceSettingsService,
	) {
		super(meta, paramDef, async (ps) => {
			const playback = await this.zalipCatalogService.getAllohaPlayback(ps.slug);
			if (playback == null) throw new ApiError(meta.errors.noSuchWork);
			const { providers } = await this.playbackSettings.show();
			const setting = providers.find(provider => provider.source === 'alloha')!;
			if (!setting.enabled) return { available: false, iframe: null, translations: [], lastCheckedAt: playback.lastCheckedAt, label: setting.label };
			const config = await this.sourceSettings.getRuntime();
			const iframe = configuredImportPlayerUrl(playback.iframe, 'alloha', config);
			const translations = playback.translations.flatMap(translation => {
				const url = configuredImportPlayerUrl(translation.iframe, 'alloha', config);
				return url ? [{ ...translation, iframe: url }] : [];
			});
			return { ...playback, available: playback.available && iframe !== null, iframe, translations, label: setting.label };
		});
	}
}
