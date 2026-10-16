/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ChatService } from './ChatService.js';

function setup() {
	const unread = new Set<string>(['user:sender01', 'room:room01']);
	const markers = new Map<string, string>([
		['newUserChatMessageExists:reader01:sender01', 'message01'],
		['newRoomChatMessageExists:reader01:room01', 'message02'],
		['newRoomChatMessageExists:other01:room01', 'message03'],
	]);
	const publishMainStream = vi.fn();
	const exec = vi.fn();
	const multi = vi.fn(() => {
		const commands: (() => void)[] = [];
		const transaction = {
			set: vi.fn((key: string, value: string) => { commands.push(() => { markers.set(key, value); }); return transaction; }),
			sadd: vi.fn((_key: string, member: string) => { commands.push(() => { unread.add(member); }); return transaction; }),
			del: vi.fn((key: string) => { commands.push(() => { markers.delete(key); }); return transaction; }),
			srem: vi.fn((key: string, member: string) => { expect(key).toBe('newChatMessagesExists:reader01'); commands.push(() => { unread.delete(member); }); return transaction; }),
			exec: async () => {
				const override: unknown = await exec();
				if (override !== undefined) return override;
				commands.forEach(command => command());
				return commands.map(() => [null, 1]);
			},
		};
		return transaction;
	});
	const afterEval = vi.fn();
	const evalScript = vi.fn(async (_script: string, keyCount: number, key: string, userPrefix: string, roomPrefix: string) => {
		expect(keyCount).toBe(1);
		expect(key).toBe('newChatMessagesExists:reader01');
		for (const member of unread) {
			if (member.startsWith('user:')) markers.delete(userPrefix + member.slice(5));
			if (member.startsWith('room:')) markers.delete(roomPrefix + member.slice(5));
		}
		unread.clear();
		afterEval();
		return 2;
	});
	const pipeline = () => {
		const keys: string[] = [];
		const commands = { get: (key: string) => { keys.push(key); return commands; }, exec: async () => keys.map(key => [null, markers.get(key) ?? null]) };
		return commands;
	};
	const redisClient = { multi, pipeline, get: vi.fn(async (key: string) => markers.get(key) ?? null), eval: evalScript, scard: vi.fn(async () => unread.size) };
	const packMessageDetailed = vi.fn().mockResolvedValue({ id: 'message01' });
	const pushNotification = vi.fn();
	const service = Object.create(ChatService.prototype) as ChatService;
	Object.assign(service, { redisClient, globalEventService: { publishMainStream }, chatEntityService: { packMessageDetailed }, pushNotificationService: { pushNotification } });
	return { service, unread, markers, publishMainStream, exec, multi, evalScript, afterEval, redisClient, packMessageDetailed, pushNotification };
}

describe('Chat unread state synchronization', () => {
	test('emits a delayed message only while its current unread marker still exists', async () => {
		const h = setup();
		await (h.service as unknown as { notifyUnreadUserMessage: (message: unknown, recipient: unknown) => Promise<void> }).notifyUnreadUserMessage({ id: 'message01', fromUserId: 'sender01' }, { id: 'reader01' });
		expect(h.publishMainStream).toHaveBeenCalledExactlyOnceWith('reader01', 'newChatMessage', { id: 'message01' });
		expect(h.pushNotification).toHaveBeenCalledOnce();
	});

	test('does not publish a room message after a Redis marker transaction resolves with an error tuple', async () => {
		const h = setup();
		const publishChatRoomStream = vi.fn();
		Object.assign(h.service, {
			chatRoomMembershipsRepository: { findBy: async () => [{ userId: 'reader01', isMuted: false }] },
			chatMessagesRepository: { insertOne: async (message: unknown) => message },
			chatEntityService: { packMessageLiteForRoom: async () => ({ id: 'newmessage01' }) },
			idService: { gen: () => 'newmessage01' }, globalEventService: { publishChatRoomStream },
		});
		h.exec.mockResolvedValueOnce([[new Error('Redis command failed'), null]]);
		await expect(h.service.createMessageToRoom({ id: 'owner01', host: null }, { id: 'room01', ownerId: 'owner01' } as never, { text: 'Fixture' })).rejects.toThrow('CHAT_REDIS_OPERATION_FAILED');
		expect(publishChatRoomStream).not.toHaveBeenCalled();
	});

	test('rejects an individual read-marker GET pipeline failure instead of returning a false read state', async () => {
		const h = setup();
		vi.spyOn(h.redisClient, 'pipeline').mockReturnValue({ get: vi.fn().mockReturnThis(), exec: async () => [[new Error('Redis command failed'), null]] } as never);
		await expect(h.service.getRoomReadStateMap('reader01', ['room01'])).rejects.toThrow('CHAT_REDIS_OPERATION_FAILED');
	});
	test.each(['all', 'user'] as const)('does not revive a read direct-chat badge after a deferred message pack (%s)', async mode => {
		const h = setup();
		let finish!: (value: unknown) => void;
		h.packMessageDetailed.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const delayed = (h.service as unknown as { notifyUnreadUserMessage: (message: unknown, recipient: unknown) => Promise<void> }).notifyUnreadUserMessage({ id: 'message01', fromUserId: 'sender01' }, { id: 'reader01' });
		await vi.waitFor(() => expect(h.packMessageDetailed).toHaveBeenCalledOnce());
		if (mode === 'all') await h.service.readAllChatMessages('reader01');
		else await h.service.readUserChatMessage('reader01', 'sender01');
		h.publishMainStream.mockClear();
		finish({ id: 'message01' });
		await delayed;
		expect(h.publishMainStream).not.toHaveBeenCalled();
		expect(h.pushNotification).not.toHaveBeenCalled();
	});

	test.each(['all', 'room'] as const)('does not revive a read room badge after a deferred message pack (%s)', async mode => {
		const h = setup();
		let finish!: (value: unknown) => void;
		h.packMessageDetailed.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
		const delayed = (h.service as unknown as { notifyUnreadRoomMessage: (message: unknown, room: string, members: { userId: string }[]) => Promise<void> }).notifyUnreadRoomMessage({ id: 'message02' }, 'room01', [{ userId: 'reader01' }]);
		await vi.waitFor(() => expect(h.packMessageDetailed).toHaveBeenCalledOnce());
		if (mode === 'all') await h.service.readAllChatMessages('reader01');
		else await h.service.readRoomChatMessage('reader01', 'room01');
		h.publishMainStream.mockClear();
		finish({ id: 'message02' });
		await delayed;
		expect(h.publishMainStream).not.toHaveBeenCalled();
		expect(h.pushNotification).not.toHaveBeenCalled();
	});

	test('rejects Redis command-error tuples and null EXEC results without publishing successful read state', async () => {
		for (const result of [null, [[new Error('Redis command failed'), null]]]) {
			const h = setup();
			h.exec.mockResolvedValueOnce(result);
			await expect(h.service.readUserChatMessage('reader01', 'sender01')).rejects.toThrow('CHAT_REDIS_OPERATION_FAILED');
			expect(h.publishMainStream).not.toHaveBeenCalled();
		}
	});
	test('reading one dialog retains the badge while a different dialog is unread', async () => {
		const { service, markers, unread, publishMainStream, multi } = setup();
		await service.readUserChatMessage('reader01', 'sender01');
		expect(multi).toHaveBeenCalledOnce();
		expect(markers.has('newUserChatMessageExists:reader01:sender01')).toBe(false);
		expect(unread).toEqual(new Set(['room:room01']));
		expect(publishMainStream).not.toHaveBeenCalled();
	});

	test('reading the final room updates all live clients immediately', async () => {
		const { service, publishMainStream } = setup();
		await service.readUserChatMessage('reader01', 'sender01');
		await service.readRoomChatMessage('reader01', 'room01');
		expect(publishMainStream).toHaveBeenCalledExactlyOnceWith('reader01', 'readAllChatMessages');
	});

	test('mark all read clears dialog markers too, but not another account', async () => {
		const { service, markers, unread, evalScript, publishMainStream } = setup();
		await service.readAllChatMessages('reader01');
		expect(evalScript).toHaveBeenCalledOnce();
		expect(markers.size).toBe(1);
		expect(markers.has('newRoomChatMessageExists:other01:room01')).toBe(true);
		expect(unread.size).toBe(0);
		expect(publishMainStream).toHaveBeenCalledExactlyOnceWith('reader01', 'readAllChatMessages');
	});

	test('a new message after mark-all-read keeps its unread state', async () => {
		const { service, unread, afterEval, publishMainStream } = setup();
		afterEval.mockImplementation(() => unread.add('user:newSender'));
		await service.readAllChatMessages('reader01');
		expect(unread.has('user:newSender')).toBe(true);
		expect(publishMainStream).not.toHaveBeenCalled();
	});

	test('never claims successful read synchronization after a Redis failure', async () => {
		const { service, evalScript, publishMainStream } = setup();
		const failure = new Error('redis unavailable');
		evalScript.mockRejectedValue(failure);
		await expect(service.readAllChatMessages('reader01')).rejects.toBe(failure);
		expect(publishMainStream).not.toHaveBeenCalled();
	});

	test('leaving the last unread room clears the live badge', async () => {
		const { service, unread, publishMainStream } = setup();
		unread.delete('user:sender01');
		const remove = vi.fn().mockResolvedValue(undefined);
		Object.assign(service, { chatRoomMembershipsRepository: { findOneByOrFail: vi.fn().mockResolvedValue({ id: 'membership01' }), delete: remove } });
		await service.leaveRoom('reader01', 'room01');
		expect(remove).toHaveBeenCalledWith('membership01');
		expect(publishMainStream).toHaveBeenCalledExactlyOnceWith('reader01', 'readAllChatMessages');
	});
});
