/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { MiLocalUser } from '@/models/User.js';
import RefreshVoices, { meta } from './refresh-voices.js';

vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipImporterService.js', () => ({ ZalipImporterService: class {} }));

const user = { id: 'admin01' } as MiLocalUser;
const role = (allowed: boolean) => ({ isAdministrator: vi.fn().mockResolvedValue(allowed) });
const input = { workId: 'work01', expected: 'a'.repeat(64) };
const service = () => ({ refreshCollapsVoices: vi.fn().mockResolvedValue({ workId: 'work01', status: 'updated', translations: 2, playbackRevision: 'b'.repeat(64) }) });

describe('Collaps voice repair API', () => {
	test('is native authenticated administrator-only with a bounded write rate', async () => {
		expect(meta.requireCredential).toBe(true);
		expect(meta.secure).toBe(true);
		expect(meta.prohibitMoved).toBe(true);
		expect(meta.limit).toEqual({ duration: 60000, max: 15 });
		const importer = service();
		await expect(new RefreshVoices(role(false) as never, importer as never).exec(input, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
		expect(importer.refreshCollapsVoices).not.toHaveBeenCalled();
	});

	test('accepts exact existing work IDs and revisions, never sources, raw URLs, IDs or tokens', async () => {
		const importer = service();
		const endpoint = new RefreshVoices(role(true) as never, importer as never);
		await expect(endpoint.exec(input, user, null)).resolves.toMatchObject({ status: 'updated', translations: 2 });
		expect(importer.refreshCollapsVoices).toHaveBeenCalledWith('work01', 'a'.repeat(64));
		for (const extra of [{ source: 'collaps' }, { externalId: '123' }, { iframe: 'https://example.org/embed' }, { token: 'private' }, { workIds: ['work01'] }, { force: true }]) await expect(endpoint.exec({ ...input, ...extra }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		for (const expected of ['', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'https://example.org/private']) await expect(endpoint.exec({ ...input, expected }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		for (const workId of ['', '../work', 'x'.repeat(33)]) await expect(endpoint.exec({ ...input, workId }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	test('never exposes raw provider errors', async () => {
		const importer = service();
		importer.refreshCollapsVoices.mockRejectedValue(new Error('private-upstream-url-token'));
		await expect(new RefreshVoices(role(true) as never, importer as never).exec(input, user, null)).rejects.toMatchObject({ code: 'ZALIP_IMPORT_UNAVAILABLE' });
	});
});
