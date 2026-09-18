/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { MAX_NOTE_TEXT_LENGTH } from '@/const.js';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { ApiError } from '@/server/api/error.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';

export const meta = {
	tags: ['zalip', 'notes'],
	requireCredential: true,
	prohibitMoved: true,
	kind: 'write:notes',
	description: 'Creates a local Misskey note with a structured card for one published Zalip title.',
	res: {
		type: 'object', optional: false, nullable: false,
		properties: {
			createdNote: { type: 'object', optional: false, nullable: false, ref: 'Note' },
		},
		required: ['createdNote'],
	},
	errors: {
		noSuchWork: {
			message: 'No such published Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: 'a8f5ef56-3774-4a40-bdcf-5744caa5854a',
			httpStatusCode: 404,
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		workId: { type: 'string', format: 'misskey:id' },
		text: { type: 'string', nullable: true, minLength: 1, maxLength: MAX_NOTE_TEXT_LENGTH },
		cw: { type: 'string', nullable: true, minLength: 1, maxLength: 100 },
		visibility: { type: 'string', enum: ['public', 'home', 'followers', 'specified'], default: 'public' },
		visibleUserIds: { type: 'array', uniqueItems: true, items: { type: 'string', format: 'misskey:id' }, default: [] },
		localOnly: { type: 'boolean', default: true },
		replyId: { type: 'string', format: 'misskey:id', nullable: true },
		renoteId: { type: 'string', format: 'misskey:id', nullable: true },
		channelId: { type: 'string', format: 'misskey:id', nullable: true },
		reactionAcceptance: { type: 'string', nullable: true, enum: [null, 'likeOnly', 'likeOnlyForRemote', 'nonSensitiveOnly', 'nonSensitiveOnlyForLocalLikeOnlyForRemote'], default: null },
	},
	required: ['workId'],
} as const;

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		private noteEntityService: NoteEntityService,
		private zalipCatalogService: ZalipCatalogService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const note = await this.zalipCatalogService.createShare(me, ps.workId, {
				text: ps.text ?? null,
				cw: ps.cw ?? null,
				visibility: ps.visibility,
				localOnly: ps.localOnly,
				visibleUserIds: ps.visibleUserIds ?? [],
				replyId: ps.replyId ?? null,
				renoteId: ps.renoteId ?? null,
				channelId: ps.channelId ?? null,
				reactionAcceptance: ps.reactionAcceptance ?? null,
			});
			if (note == null) throw new ApiError(meta.errors.noSuchWork);
			return { createdNote: await this.noteEntityService.pack(note, me) };
		});
	}
}
