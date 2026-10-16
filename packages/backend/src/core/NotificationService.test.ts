/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ReplyError } from 'ioredis';
import { NotificationService, notificationInsertOnceScript } from '@/core/NotificationService.js';

function harness() {
	let sequence = 0;
	const receipts = new Map<string, string>();
	const notices: unknown[] = [];
	const redis = {
		eval: vi.fn(async (_script: string, _count: number, _timeline: string, receipt: string, _max: string, redisId: string, data: string) => {
			if (receipts.has(receipt)) return [0, receipts.get(receipt)];
			notices.push(JSON.parse(data));
			receipts.set(receipt, redisId);
			return [1, redisId];
		}),
		xadd: vi.fn().mockResolvedValue('1-1'),
	};
	const entities = { pack: vi.fn(async value => value) };
	const events = { publishMainStream: vi.fn() };
	const service = new NotificationService(
		{ perUserNotificationsMaxCount: 100 } as never, redis as never, {} as never,
		entities as never, { gen: () => `notice${++sequence}`, parseFull: () => ({ date: 1, additional: BigInt(sequence) }) } as never,
		events as never, { pushNotification: vi.fn() } as never,
		{ userProfileCache: { fetch: async () => ({ notificationRecieveConfig: {} }) } } as never, {} as never,
	);
	return { service, redis, receipts, notices, entities, events };
}

const data = { workId: 'work', workSlug: 'work', workTitle: 'Work', seasonNumber: null, episodeNumber: null, translationCount: 1 };

describe('NotificationService persistent outbox idempotency', () => {
	it('uses one atomic XADD/receipt operation with no expiry or private payload in the receipt', async () => {
		const h = harness();
		try {
			await Promise.all([1, 2].map(() => h.service.createNotificationOnceAndWait('zalip:availability:event', 'viewer', 'zalipAllohaAvailable', data)));
			expect(h.notices).toHaveLength(1);
			expect(h.entities.pack).toHaveBeenCalledOnce();
			expect(h.events.publishMainStream).toHaveBeenCalledOnce();
			expect(h.redis.xadd).not.toHaveBeenCalled();
			expect(h.redis.eval).toHaveBeenCalledWith(notificationInsertOnceScript, 2, 'notificationTimeline:viewer', expect.stringMatching(/^notificationReceipt:[a-f0-9]{64}$/u), '100', expect.stringMatching(/^1-\d+$/u), expect.any(String));
			expect(notificationInsertOnceScript).toMatch(/XADD[\s\S]*SET/u);
			expect(notificationInsertOnceScript).not.toMatch(/\b(?:EXPIRE|PEXPIRE|EX|PX)\b/u);
			expect([...h.receipts.values()]).toEqual(['1-1']);
		} finally { h.service.dispose(); }
	});
	it('retains idempotency after stream trimming and after a lost Redis acknowledgement', async () => {
		const h = harness();
		const original = h.redis.eval.getMockImplementation()!;
		h.redis.eval.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Lost acknowledgement'); });
		try {
			await expect(h.service.createNotificationOnceAndWait('event', 'viewer', 'zalipAllohaAvailable', data)).rejects.toThrow('Lost acknowledgement');
			h.notices.length = 0; // Native timeline MAXLEN or explicit user notification flush.
			await expect(h.service.createNotificationOnceAndWait('event', 'viewer', 'zalipAllohaAvailable', data)).resolves.toBeNull();
			expect(h.notices).toHaveLength(0);
			expect(h.entities.pack).not.toHaveBeenCalled();
			expect(h.events.publishMainStream).not.toHaveBeenCalled();
		} finally { h.service.dispose(); }
	});
	it('scopes permanent receipts to the event, recipient and notification type', async () => {
		const h = harness();
		try {
			await h.service.createNotificationOnceAndWait('event1', 'viewer1', 'zalipAllohaAvailable', data);
			await h.service.createNotificationOnceAndWait('event1', 'viewer2', 'zalipAllohaAvailable', data);
			await h.service.createNotificationOnceAndWait('event2', 'viewer1', 'zalipAllohaAvailable', data);
			expect(h.receipts.size).toBe(3);
			expect(h.notices).toHaveLength(3);
		} finally { h.service.dispose(); }
	});
	it('does not retry permanent Redis errors or malformed receipt results indefinitely', async () => {
		const h = harness();
		try {
			h.redis.eval.mockRejectedValueOnce(new ReplyError('WRONGTYPE Operation against a key holding the wrong kind of value'));
			await expect(h.service.createNotificationOnceAndWait('event', 'viewer', 'zalipAllohaAvailable', data)).rejects.toThrow('WRONGTYPE');
			expect(h.redis.eval).toHaveBeenCalledOnce();
			h.redis.eval.mockResolvedValueOnce([2, 'not-a-stream-id']);
			await expect(h.service.createNotificationOnceAndWait('event', 'viewer', 'zalipAllohaAvailable', data)).rejects.toThrow('INVALID_NOTIFICATION_RECEIPT');
		} finally { h.service.dispose(); }
	});
});
