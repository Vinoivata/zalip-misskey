/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { MiLocalUser } from '@/models/User.js';
import type { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import type { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import CreateShare, { meta } from './create.js';

vi.mock('@/core/entities/NoteEntityService.js', () => ({ NoteEntityService: class {} }));
vi.mock('@/core/ZalipCatalogService.js', () => ({ ZalipCatalogService: class {} }));

const user = { id: 'user01' } as MiLocalUser;

function setup() {
	const pack = vi.fn().mockResolvedValue({ id: 'note01' });
	const createShare = vi.fn().mockResolvedValue({ id: 'note01' });
	return { pack, createShare, endpoint: new CreateShare({ pack } as unknown as NoteEntityService, { createShare } as unknown as ZalipCatalogService) };
}

describe('Zalip share posting protections', () => {
	test('shares the ordinary posting limit instead of granting an independent budget', () => {
		expect(meta.limit).toEqual({ key: 'notes/create', duration: 3600000, max: 300 });
		expect(meta.requireCredential).toBe(true);
		expect(meta.prohibitMoved).toBe(true);
		expect(meta.kind).toBe('write:notes');
	});

	test('creates an ordinary structured share with explicit safe defaults', async () => {
		const { endpoint, createShare, pack } = setup();
		await expect(endpoint.exec({ workId: 'work01' }, user, null)).resolves.toEqual({ createdNote: { id: 'note01' } });
		expect(createShare).toHaveBeenCalledWith(user, 'work01', { text: null, cw: null, visibility: 'public', localOnly: true, visibleUserIds: [], replyId: null, renoteId: null, channelId: null, reactionAcceptance: null });
		expect(pack).toHaveBeenCalledWith({ id: 'note01' }, user);
	});

	test.each([
		['689ee33f-f97c-479a-ac49-1b9f8140af99', 'CONTAINS_PROHIBITED_WORDS'],
		['9f466dab-c856-48cd-9e65-ff90ff750580', 'CONTAINS_TOO_MANY_MENTIONS'],
		['801c046c-5bf5-4234-ad2b-e78fc20a2ac7', 'NO_SUCH_FILE'],
		['53983c56-e163-45a6-942f-4ddc485d4290', 'NO_SUCH_RENOTE_TARGET'],
		['bde24c37-121f-4e7d-980d-cec52f599f02', 'CANNOT_RENOTE_TO_A_PURE_RENOTE'],
		['2b4fe776-4414-4a2d-ae39-f3418b8fd4d3', 'YOU_HAVE_BEEN_BLOCKED'],
		['90b9d6f0-893a-4fef-b0f1-e9a33989f71a', 'CANNOT_RENOTE_DUE_TO_VISIBILITY'],
		['48d7a997-da5c-4716-b3c3-92db3f37bf7d', 'CANNOT_RENOTE_DUE_TO_VISIBILITY'],
		['b060f9a6-8909-4080-9e0b-94d9fa6f6a77', 'NO_SUCH_CHANNEL'],
		['7e435f4a-780d-4cfc-a15a-42519bd6fb67', 'CANNOT_RENOTE_OUTSIDE_OF_CHANNEL'],
		['60142edb-1519-408e-926d-4f108d27bee0', 'NO_SUCH_REPLY_TARGET'],
		['f089e4e2-c0e7-4f60-8a23-e5a6bf786b36', 'CANNOT_REPLY_TO_A_PURE_RENOTE'],
		['11cd37b3-a411-4f77-8633-c580ce6a8dce', 'CANNOT_REPLY_TO_AN_INVISIBLE_NOTE'],
		['ced780a1-2012-4caf-bc7e-a95a291294cb', 'CANNOT_REPLY_TO_SPECIFIED_VISIBILITY_NOTE_WITH_EXTENDED_VISIBILITY'],
		['b0df6025-f2e8-44b4-a26a-17ad99104612', 'YOU_HAVE_BEEN_BLOCKED'],
		['0c11c11e-0c8d-48e7-822c-76ccef660068', 'CANNOT_CREATE_ALREADY_EXPIRED_POLL'],
		['bfa3905b-25f5-4894-b430-da331a490e4b', 'NO_SUCH_CHANNEL'],
	])('maps native creation failure %s to a declared client error', async (id, code) => {
		const { endpoint, createShare, pack } = setup();
		createShare.mockRejectedValue(new IdentifiableError(id, 'private upstream detail'));
		await expect(endpoint.exec({ workId: 'work01' }, user, null)).rejects.toMatchObject({ code, kind: 'client' });
		expect(pack).not.toHaveBeenCalled();
	});

	test('does not hide unexpected infrastructure failures', async () => {
		const { endpoint, createShare } = setup();
		const failure = new Error('database unavailable');
		createShare.mockRejectedValue(failure);
		await expect(endpoint.exec({ workId: 'work01' }, user, null)).rejects.toBe(failure);
	});

	test('does not expose drafts or nonexistent works', async () => {
		const { endpoint, createShare, pack } = setup();
		createShare.mockResolvedValue(null);
		await expect(endpoint.exec({ workId: 'work01' }, user, null)).rejects.toMatchObject({ code: 'NO_SUCH_ZALIP_WORK', httpStatusCode: 404 });
		expect(pack).not.toHaveBeenCalled();
	});
});
