/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { MiLocalUser } from '@/models/User.js';
import RefreshPlayers, { meta } from './refresh-players.js';

vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipImporterService.js', () => ({ ZalipImporterService: class {} }));

const user = { id: 'admin01' } as MiLocalUser;
const role = (allowed: boolean) => ({ isAdministrator: vi.fn().mockResolvedValue(allowed) });
const input = { workId: 'work01', source: 'vibix' as const, expected: 'a'.repeat(64) };
const service = () => ({ refreshPlayers: vi.fn().mockResolvedValue({ workId: 'work01', source: 'vibix', status: 'queued', runId: 'run01', playbackRevision: 'a'.repeat(64) }) });

describe('existing-title Vibix player refresh API', () => {
	test('requires a native authenticated administrator and bounds writes', async () => {
		expect(meta).toMatchObject({ requireCredential: true, secure: true, prohibitMoved: true, kind: 'write:account', limit: { duration: 60000, max: 6 } });
		const importer = service();
		await expect(new RefreshPlayers(role(false) as never, importer as never).exec(input, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
		expect(importer.refreshPlayers).not.toHaveBeenCalled();
	});

	test('passes only the existing work, forced source, revision and authenticated actor', async () => {
		const importer = service();
		await expect(new RefreshPlayers(role(true) as never, importer as never).exec(input, user, null)).resolves.toMatchObject({ status: 'queued', runId: 'run01' });
		expect(importer.refreshPlayers).toHaveBeenCalledExactlyOnceWith('work01', 'vibix', 'a'.repeat(64), 'admin01');
	});

	test('cannot select providers, URLs, locks, metadata, categories, profiles or create a new title', async () => {
		const endpoint = new RefreshPlayers(role(true) as never, service() as never);
		for (const extra of [{ source: 'collaps' }, { externalId: '123' }, { url: 'https://example.org' }, { token: 'private' }, { actorId: 'other' }, { fields: ['title'] }, { options: { sources: ['tmdb'] } }, { lockedFields: [] }, { categoryIds: ['category01'] }, { profileId: 'profile01' }, { mode: 'import' }, { force: true }]) await expect(endpoint.exec({ ...input, ...extra } as never, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		for (const expected of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) await expect(endpoint.exec({ ...input, expected }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		for (const workId of ['', '../work', 'x'.repeat(33)]) await expect(endpoint.exec({ ...input, workId }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	test('uses declared native errors and never exposes upstream or database secrets', async () => {
		const importer = service(); const endpoint = new RefreshPlayers(role(true) as never, importer as never);
		importer.refreshPlayers.mockRejectedValueOnce(new Error('NO_SUCH_WORK'));
		await expect(endpoint.exec(input, user, null)).rejects.toMatchObject({ code: 'ZALIP_IMPORT_NOT_FOUND' });
		importer.refreshPlayers.mockRejectedValueOnce(new Error('private-url-token-database-detail'));
		await expect(endpoint.exec(input, user, null)).rejects.toMatchObject({ code: 'ZALIP_IMPORT_UNAVAILABLE' });
	});
});
