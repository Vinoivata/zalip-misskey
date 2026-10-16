/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { MiZalipAllohaAvailabilityEvent } from '@/models/ZalipAllohaAvailabilityEvent.js';
import { MiZalipReleaseEvent } from '@/models/ZalipReleaseEvent.js';

function harness(kind: 'release' | 'availability') {
	const event = {
		id: 'event01', work: { id: 'work01', slug: 'work', title: 'Work', publicationState: 'published' },
		season: { seasonNumber: 1 }, episode: { episodeNumber: 2, title: 'Episode' },
		seasonNumber: 1, episodeNumber: 2, translationCount: 1,
	};
	let delivered = false;
	let failRecipient = false;
	let failDatabaseAck = false;
	const receipts = new Set<string>();
	const inserted: string[] = [];
	const notifications = {
		createNotificationOnceAndWait: vi.fn(async (key: string, recipient: string, type: string) => {
			if (recipient === 'viewer2' && failRecipient) { failRecipient = false; throw new Error('Recipient failed'); }
			const receipt = JSON.stringify([key, recipient, type]);
			if (!receipts.has(receipt)) { receipts.add(receipt); inserted.push(recipient); }
			return null;
		}),
	};
	const update = vi.fn(async () => {
		if (failDatabaseAck) { failDatabaseAck = false; throw new Error('Database acknowledgement lost'); }
		delivered = true;
	});
	const eventModel = kind === 'release' ? MiZalipReleaseEvent : MiZalipAllohaAvailabilityEvent;
	const query = {
		innerJoinAndSelect: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
		andWhere: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), take: vi.fn().mockReturnThis(),
		// Deliberately allow stale initial scans so only the locked re-read can prevent a duplicate.
		getMany: vi.fn(async () => [event]),
	};
	let busy = false;
	let held = false;
	const db = {
		getRepository: () => ({ createQueryBuilder: () => query }),
		transaction: async (action: (manager: unknown) => Promise<void>) => {
			let locked = false;
			const manager = {
				query: async (sql: string, parameters: string[]) => {
					expect(sql).toBe('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked');
					expect(['zalip-notification-dispatch', `zalip-notification:${kind}:event01`]).toContain(parameters[0]);
					if (busy || (held && !locked)) return [{ locked: false }];
					held = true;
					locked = true;
					return [{ locked: true }];
				},
				getRepository: (model: unknown) => model === eventModel ? {
					findOne: async () => { expect(locked).toBe(true); return delivered ? null : event; }, update,
				} : { find: async () => [{ userId: 'viewer1' }, { userId: 'viewer2' }] },
			};
			try { return await action(manager); } finally { if (locked) held = false; }
		},
	};
	const service = () => new ZalipCatalogService(db as never, {} as never, {} as never, notifications as never);
	const dispatch = (instance = service()) => kind === 'availability' ? instance.dispatchPendingAllohaAvailabilityNotifications() : (instance as unknown as { dispatchPendingReleaseNotifications: () => Promise<void> }).dispatchPendingReleaseNotifications();
	return { dispatch, service, notifications, inserted, update, setBusy: () => { busy = true; }, failOneRecipient: () => { failRecipient = true; }, failOneDatabaseAck: () => { failDatabaseAck = true; } };
}

describe.each(['release', 'availability'] as const)('Zalip %s durable notification outbox', kind => {
	it('skips a busy global claim without waiting or packing any recipients', async () => {
		const h = harness(kind);
		h.setBusy();
		await h.dispatch();
		expect(h.notifications.createNotificationOnceAndWait).not.toHaveBeenCalled();
		expect(h.update).not.toHaveBeenCalled();
	});
	it('retries a partial recipient failure without reinserting a successful recipient', async () => {
		const h = harness(kind);
		h.failOneRecipient();
		await expect(h.dispatch()).rejects.toThrow('Recipient failed');
		expect(h.inserted).toEqual(['viewer1']);
		expect(h.update).not.toHaveBeenCalled();
		await h.dispatch();
		expect(h.inserted).toEqual(['viewer1', 'viewer2']);
		expect(h.update).toHaveBeenCalledOnce();
	});
	it('serializes independent dispatchers and rechecks the committed pending marker', async () => {
		const h = harness(kind);
		await Promise.all([h.dispatch(h.service()), h.dispatch(h.service())]);
		expect(h.inserted).toEqual(['viewer1', 'viewer2']);
		expect(h.notifications.createNotificationOnceAndWait).toHaveBeenCalledTimes(2);
		expect(h.update).toHaveBeenCalledOnce();
	});
	it('survives Redis success followed by a failed PostgreSQL delivery acknowledgement', async () => {
		const h = harness(kind);
		h.failOneDatabaseAck();
		await expect(h.dispatch()).rejects.toThrow('Database acknowledgement lost');
		expect(h.inserted).toEqual(['viewer1', 'viewer2']);
		await h.dispatch();
		expect(h.inserted).toEqual(['viewer1', 'viewer2']);
		expect(h.notifications.createNotificationOnceAndWait).toHaveBeenCalledTimes(4);
		expect(h.update).toHaveBeenCalledTimes(2);
	});
});
