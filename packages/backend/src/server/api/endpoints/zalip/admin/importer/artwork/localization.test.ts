/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import type { MiLocalUser } from '@/models/User.js';
import Inspect, { meta as inspectMeta } from './inspect.js';
import Step, { meta as stepMeta } from './step.js';

vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));
vi.mock('@/core/ZalipArtworkLocalizationService.js', () => ({ ZalipArtworkLocalizationService: class {} }));

const user = { id: 'admin01' } as MiLocalUser;
const target = { kind: 'work', id: 'work01', field: 'posterPath', expected: 'a'.repeat(64) };
const role = (allowed: boolean) => ({ isAdministrator: vi.fn().mockResolvedValue(allowed) });
const localization = () => ({ inspect: vi.fn().mockResolvedValue({ targets: [], nextId: null }), step: vi.fn().mockResolvedValue({ ...target, status: 'localized', images: 1 }) });

describe('operator artwork API boundaries', () => {
	test('requires native authenticated administrator requests with rate bounds', async () => {
		for (const meta of [inspectMeta, stepMeta]) {
			expect(meta.requireCredential).toBe(true);
			expect(meta.secure).toBe(true);
			expect(meta.limit.max).toBeLessThanOrEqual(120);
		}
		const service = localization();
		await expect(new Inspect(role(false) as never, service as never).exec({ kind: 'work' }, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
		await expect(new Step(role(false) as never, service as never).exec(target, user, null)).rejects.toMatchObject({ code: 'ZALIP_ADMIN_REQUIRED' });
		expect(service.inspect).not.toHaveBeenCalled();
		expect(service.step).not.toHaveBeenCalled();
	});

	test('forwards only strict IDs, field and exact manifest hash; raw URLs/configuration cannot enter', async () => {
		const service = localization();
		const inspect = new Inspect(role(true) as never, service as never);
		const step = new Step(role(true) as never, service as never);
		await inspect.exec({ kind: 'episode', limit: 200, afterId: 'row01' }, user, null);
		expect(service.inspect).toHaveBeenCalledWith('episode', 'row01', 200);
		await step.exec(target, user, null);
		expect(service.step).toHaveBeenCalledWith('work', 'work01', 'posterPath', 'a'.repeat(64));
		for (const extra of [{ url: 'https://evil.example.org/image' }, { token: 'private' }, { format: 'webp' }, { ids: ['work01', 'work02'] }]) await expect(step.exec({ ...target, ...extra }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		for (const id of ['', '../work01', 'x'.repeat(33)]) await expect(step.exec({ ...target, id }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		for (const limit of [0, 201, 1.5]) await expect(inspect.exec({ kind: 'work', limit }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		await expect(step.exec({ ...target, expected: 'https://image.tmdb.org/chosen.jpg' }, user, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
	});

	test('internal exceptions have safe fixed errors without upstream details', async () => {
		const service = localization();
		service.step.mockRejectedValue(new Error('fixture-private-remote-url-token'));
		await expect(new Step(role(true) as never, service as never).exec(target, user, null)).rejects.toMatchObject({ code: 'ZALIP_IMPORT_UNAVAILABLE' });
	});
});
