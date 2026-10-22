/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import type { ChannelsRepository, DriveFilesRepository } from '@/models/_.js';
import type { MiLocalUser } from '@/models/User.js';
import type { ChannelEntityService } from '@/core/entities/ChannelEntityService.js';
import type { RoleService } from '@/core/RoleService.js';
import UpdateChannel from './update.js';

vi.mock('@/core/entities/ChannelEntityService.js', () => ({ ChannelEntityService: class {} }));
vi.mock('@/core/RoleService.js', () => ({ RoleService: class {} }));

function setup() {
	const owner = { id: 'owner' } as MiLocalUser;
	const other = { id: 'other' } as MiLocalUser;
	const channel = { id: 'channel', userId: owner.id, bannerId: 'original', name: 'Original name' };
	const channels = {
		findOneBy: vi.fn().mockResolvedValue(channel),
		update: vi.fn(async (_id: string, patch: Partial<typeof channel>) => { Object.assign(channel, patch); }),
	};
	const files = { findOneBy: vi.fn().mockResolvedValue({ id: 'replacement', userId: owner.id }) };
	const entities = { pack: vi.fn(async () => ({ ...channel })) };
	const roles = { isModerator: vi.fn().mockResolvedValue(false) };
	const endpoint = new UpdateChannel(
		channels as unknown as ChannelsRepository,
		files as unknown as DriveFilesRepository,
		entities as unknown as ChannelEntityService,
		roles as unknown as RoleService,
	);
	return { owner, other, channel, channels, files, entities, roles, endpoint };
}

describe('native channel banner update semantics', () => {
	it('leaves an omitted banner untouched while saving other fields', async () => {
		const { owner, channel, channels, files, endpoint } = setup();
		const result = await endpoint.exec({ channelId: channel.id, name: 'Renamed' }, owner, null);
		expect(result).toMatchObject({ name: 'Renamed', bannerId: 'original' });
		expect(channels.update).toHaveBeenCalledExactlyOnceWith(channel.id, { name: 'Renamed' });
		expect(files.findOneBy).not.toHaveBeenCalled();
	});
	it('persists an explicit null and returns the cleared banner', async () => {
		const { owner, channel, channels, files, endpoint } = setup();
		const result = await endpoint.exec({ channelId: channel.id, bannerId: null }, owner, null);
		expect(channels.update).toHaveBeenCalledExactlyOnceWith(channel.id, { bannerId: null });
		expect(result.bannerId).toBeNull();
		expect(files.findOneBy).not.toHaveBeenCalled();
	});
	it('replaces the banner only after resolving a file owned by the signed-in editor', async () => {
		const { owner, channel, channels, files, endpoint } = setup();
		const result = await endpoint.exec({ channelId: channel.id, bannerId: 'replacement' }, owner, null);
		expect(files.findOneBy).toHaveBeenCalledExactlyOnceWith({ id: 'replacement', userId: owner.id });
		expect(channels.update).toHaveBeenCalledExactlyOnceWith(channel.id, { bannerId: 'replacement' });
		expect(result.bannerId).toBe('replacement');
	});
	it.each(['missing', 'foreign'])('does not clear or replace the existing banner when the %s file is unavailable to the editor', async bannerId => {
		const { owner, channel, channels, files, endpoint } = setup();
		files.findOneBy.mockResolvedValue(null);
		await expect(endpoint.exec({ channelId: channel.id, bannerId }, owner, null)).rejects.toMatchObject({ code: 'NO_SUCH_FILE' });
		expect(files.findOneBy).toHaveBeenCalledExactlyOnceWith({ id: bannerId, userId: owner.id });
		expect(channels.update).not.toHaveBeenCalled();
		expect(channel.bannerId).toBe('original');
	});
	it('does not let an unrelated user clear a channel banner', async () => {
		const { other, channel, channels, files, endpoint } = setup();
		await expect(endpoint.exec({ channelId: channel.id, bannerId: null }, other, null)).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
		expect(channels.update).not.toHaveBeenCalled();
		expect(files.findOneBy).not.toHaveBeenCalled();
		expect(channel.bannerId).toBe('original');
	});
	it('preserves the existing moderator permission to clear a channel banner', async () => {
		const { other, channel, channels, roles, endpoint } = setup();
		roles.isModerator.mockResolvedValue(true);
		await endpoint.exec({ channelId: channel.id, bannerId: null }, other, null);
		expect(channels.update).toHaveBeenCalledExactlyOnceWith(channel.id, { bannerId: null });
	});
	it('keeps moderator replacement restricted to that moderator’s own files', async () => {
		const { other, channel, files, roles, endpoint } = setup();
		roles.isModerator.mockResolvedValue(true);
		await endpoint.exec({ channelId: channel.id, bannerId: 'replacement' }, other, null);
		expect(files.findOneBy).toHaveBeenCalledExactlyOnceWith({ id: 'replacement', userId: other.id });
	});
	it('fails without writing when the target channel does not exist', async () => {
		const { owner, channels, files, endpoint } = setup();
		channels.findOneBy.mockResolvedValue(null);
		await expect(endpoint.exec({ channelId: 'missing', bannerId: null }, owner, null)).rejects.toMatchObject({ code: 'NO_SUCH_CHANNEL' });
		expect(channels.update).not.toHaveBeenCalled();
		expect(files.findOneBy).not.toHaveBeenCalled();
	});
	it('retains the API input validator for malformed banner IDs', async () => {
		const { owner, channel, channels, endpoint } = setup();
		await expect(endpoint.exec({ channelId: channel.id, bannerId: '../file' }, owner, null)).rejects.toMatchObject({ code: 'INVALID_PARAM' });
		expect(channels.findOneBy).not.toHaveBeenCalled();
		expect(channels.update).not.toHaveBeenCalled();
	});
});
