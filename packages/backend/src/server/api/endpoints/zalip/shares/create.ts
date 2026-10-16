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
import { IdentifiableError } from '@/misc/identifiable-error.js';

export const meta = {
	tags: ['zalip', 'notes'],
	requireCredential: true,
	prohibitMoved: true,
	// A structured share is still a post: share the native posting budget, not a second allowance.
	limit: { key: 'notes/create', duration: 60 * 60 * 1000, max: 300 },
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
		noSuchRenoteTarget: { message: 'No such renote target.', code: 'NO_SUCH_RENOTE_TARGET', id: 'e5654478-7a42-485c-bd37-a625522c4c0a' },
		cannotReRenote: { message: 'You can not Renote a pure Renote.', code: 'CANNOT_RENOTE_TO_A_PURE_RENOTE', id: '62efdf8d-3533-477a-b854-7248759a1f27' },
		cannotRenoteDueToVisibility: { message: 'You can not Renote due to target visibility.', code: 'CANNOT_RENOTE_DUE_TO_VISIBILITY', id: 'b139a05d-2a6c-47cf-9309-2dce379e23a7' },
		noSuchReplyTarget: { message: 'No such reply target.', code: 'NO_SUCH_REPLY_TARGET', id: '8c531839-7259-412c-a3d5-53dbd449cd39' },
		cannotReplyToInvisibleNote: { message: 'You cannot reply to an invisible Note.', code: 'CANNOT_REPLY_TO_AN_INVISIBLE_NOTE', id: 'bb5105ba-74e0-4417-bc87-60107181cd31' },
		cannotReplyToPureRenote: { message: 'You can not reply to a pure Renote.', code: 'CANNOT_REPLY_TO_A_PURE_RENOTE', id: 'd4fad8fc-3529-4e42-9c42-33825a3142c2' },
		cannotReplyToSpecifiedVisibilityNoteWithExtendedVisibility: { message: 'You cannot reply to a specified visibility note with extended visibility.', code: 'CANNOT_REPLY_TO_SPECIFIED_VISIBILITY_NOTE_WITH_EXTENDED_VISIBILITY', id: 'bfd44c83-f191-45d4-9565-a576be5d9e9c' },
		noSuchChannel: { message: 'No such channel.', code: 'NO_SUCH_CHANNEL', id: 'e57e8d1f-bf6f-4281-9a4c-b9b25e0b7d09' },
		youHaveBeenBlocked: { message: 'You have been blocked by this user.', code: 'YOU_HAVE_BEEN_BLOCKED', id: '30c1657e-0f8d-4121-8ed7-edf862376576' },
		cannotRenoteOutsideOfChannel: { message: 'Cannot renote outside of channel.', code: 'CANNOT_RENOTE_OUTSIDE_OF_CHANNEL', id: '123af7df-d835-4fed-9115-411988f5e8a7' },
		containsProhibitedWords: { message: 'Cannot post because it contains prohibited words.', code: 'CONTAINS_PROHIBITED_WORDS', id: '872bedfd-cec2-4134-8c5b-aad67afdc18f' },
		containsTooManyMentions: { message: 'Cannot post because it exceeds the allowed number of mentions.', code: 'CONTAINS_TOO_MANY_MENTIONS', id: '95893ade-4461-49b0-a19c-164531d3b16c' },
		noSuchFile: { message: 'Some files are not found.', code: 'NO_SUCH_FILE', id: 'cba6d7cc-fbfa-4d69-aad5-db4d1a470fed' },
		cannotCreateAlreadyExpiredPoll: { message: 'Poll is already expired.', code: 'CANNOT_CREATE_ALREADY_EXPIRED_POLL', id: '13eff0ec-8ff9-461b-acbd-0e7876b42f45' },
		noSuchWork: {
			message: 'No such published Zalip work.',
			code: 'NO_SUCH_ZALIP_WORK',
			id: 'a8f5ef56-3774-4a40-bdcf-5744caa5854a',
			httpStatusCode: 404,
		},
	},
} as const;

const noteCreationErrors = {
	'689ee33f-f97c-479a-ac49-1b9f8140af99': 'containsProhibitedWords',
	'9f466dab-c856-48cd-9e65-ff90ff750580': 'containsTooManyMentions',
	'801c046c-5bf5-4234-ad2b-e78fc20a2ac7': 'noSuchFile',
	'53983c56-e163-45a6-942f-4ddc485d4290': 'noSuchRenoteTarget',
	'bde24c37-121f-4e7d-980d-cec52f599f02': 'cannotReRenote',
	'2b4fe776-4414-4a2d-ae39-f3418b8fd4d3': 'youHaveBeenBlocked',
	'90b9d6f0-893a-4fef-b0f1-e9a33989f71a': 'cannotRenoteDueToVisibility',
	'48d7a997-da5c-4716-b3c3-92db3f37bf7d': 'cannotRenoteDueToVisibility',
	'b060f9a6-8909-4080-9e0b-94d9fa6f6a77': 'noSuchChannel',
	'7e435f4a-780d-4cfc-a15a-42519bd6fb67': 'cannotRenoteOutsideOfChannel',
	'60142edb-1519-408e-926d-4f108d27bee0': 'noSuchReplyTarget',
	'f089e4e2-c0e7-4f60-8a23-e5a6bf786b36': 'cannotReplyToPureRenote',
	'11cd37b3-a411-4f77-8633-c580ce6a8dce': 'cannotReplyToInvisibleNote',
	'ced780a1-2012-4caf-bc7e-a95a291294cb': 'cannotReplyToSpecifiedVisibilityNoteWithExtendedVisibility',
	'b0df6025-f2e8-44b4-a26a-17ad99104612': 'youHaveBeenBlocked',
	'0c11c11e-0c8d-48e7-822c-76ccef660068': 'cannotCreateAlreadyExpiredPoll',
	'bfa3905b-25f5-4894-b430-da331a490e4b': 'noSuchChannel',
} as const satisfies Record<string, keyof typeof meta.errors>;

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
			}).catch((error: unknown) => {
				if (error instanceof IdentifiableError && Object.hasOwn(noteCreationErrors, error.id)) {
					throw new ApiError(meta.errors[noteCreationErrors[error.id as keyof typeof noteCreationErrors]]);
				}
				throw error;
			});
			if (note == null) throw new ApiError(meta.errors.noSuchWork);
			return { createdNote: await this.noteEntityService.pack(note, me) };
		});
	}
}
