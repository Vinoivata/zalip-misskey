/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from 'vitest';
import type { entities } from 'misskey-js';
import { groupZalipReleaseNotifications } from '@/utility/zalip-notification-groups.js';
import type { ZalipReleaseNotification } from '@/utility/zalip-notification-groups.js';

const day = new Date(2026, 9, 12, 12).toISOString();
const release = (id: string, patch: Partial<ZalipReleaseNotification> & { isRead?: boolean } = {}) => ({ type: 'zalipAllohaAvailable', id, createdAt: day, workId: 'lanxiang', workSlug: 'lanxiang', workTitle: 'Lan Xiang', seasonNumber: 1, episodeNumber: 1, translationCount: 2, isRead: true, ...patch }) as ZalipReleaseNotification & { isRead?: boolean };
const ids = (rows: ReturnType<typeof groupZalipReleaseNotifications>) => rows.flatMap(row => row.members.map(item => item.id));

describe('native release notification presentation grouping', () => {
	it('groups ten adjacent received episodes while retaining every original object, id and coordinate', () => {
		const notifications = Object.freeze(Array.from({ length: 10 }, (_, index) => Object.freeze(release(`release${index}`, { episodeNumber: 20 - index }))));
		const rows = groupZalipReleaseNotifications(notifications);
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(notifications[0].id);
		expect(rows[0].notification).toBe(notifications[0]);
		expect(rows[0].releaseNotifications).toEqual(notifications);
		for (let index = 0; index < notifications.length; index++) expect(rows[0].members[index]).toBe(notifications[index]);
		expect(ids(rows)).toEqual(notifications.map(item => item.id));
	});

	it('keeps explicit read and unread boundaries, and never combines unknown status', () => {
		const rows = groupZalipReleaseNotifications([release('read'), release('unread1', { isRead: false }), release('unread2', { isRead: false }), release('read2'), release('unknown1', { isRead: undefined }), release('unknown2', { isRead: undefined })]);
		expect(rows.map(row => row.members.map(item => item.id))).toEqual([['read'], ['unread1', 'unread2'], ['read2'], ['unknown1'], ['unknown2']]);
	});

	it('does not group across an ordinary notification, another work or another release kind', () => {
		const ordinary: entities.Notification = { type: 'test', id: 'social', createdAt: day };
		const episode = { ...release('catalogue'), type: 'zalipEpisodeReleased', episodeTitle: 'Actual title' } as ZalipReleaseNotification;
		const notifications = [release('one'), ordinary, release('two'), release('other', { workId: 'other' }), release('three'), episode];
		const rows = groupZalipReleaseNotifications(notifications);
		expect(rows).toHaveLength(notifications.length);
		expect(rows[1].notification).toBe(ordinary);
		expect(rows[1].releaseNotifications).toBeUndefined();
		expect(ids(rows)).toEqual(notifications.map(item => item.id));
	});

	it('uses the same viewer-local calendar boundaries as the native date headers', () => {
		const midnight = [new Date(2026, 9, 12, 23, 59), new Date(2026, 9, 13, 0, 1)];
		expect(groupZalipReleaseNotifications(midnight.map((time, index) => release(`date${index}`, { createdAt: time.toISOString() })))).toHaveLength(2);
		// These strings have different written dates but represent exactly the same instant.
		expect(groupZalipReleaseNotifications([release('offset', { createdAt: '2026-10-12T01:00:00+02:00' }), release('utc', { createdAt: '2026-10-11T23:00:00Z' })])).toHaveLength(1);
		expect(groupZalipReleaseNotifications([release('old', { createdAt: new Date(2025, 9, 12, 12).toISOString() }), release('new')])).toHaveLength(2);
	});

	it('does not infer a calendar day for malformed dates or fabricate missing episode ranges', () => {
		const rows = groupZalipReleaseNotifications([release('broken1', { createdAt: 'invalid' }), release('broken2', { createdAt: 'invalid' }), release('episode8', { episodeNumber: 8 }), release('episode3', { episodeNumber: 3 }), release('second-event3', { episodeNumber: 3 })]);
		expect(rows).toHaveLength(3);
		expect(rows[2].releaseNotifications?.map(item => item.episodeNumber)).toEqual([8, 3, 3]);
		expect(ids(rows)).toEqual(['broken1', 'broken2', 'episode8', 'episode3', 'second-event3']);
	});

	it('recomputes groups after pagination and stream insertion without mutating raw items or their cursor ids', () => {
		const first = [release('newer', { episodeNumber: 6 }), release('older', { episodeNumber: 5 })];
		const olderPage = [release('oldest', { episodeNumber: 2 })];
		const combined = [...first, ...olderPage];
		const before = structuredClone(combined);
		expect(groupZalipReleaseNotifications(first)[0].members).toHaveLength(2);
		const paged = groupZalipReleaseNotifications(combined);
		expect(paged).toHaveLength(1);
		expect(ids(paged)).toEqual(['newer', 'older', 'oldest']);
		const incoming = release('incoming', { episodeNumber: 7 });
		expect(ids(groupZalipReleaseNotifications([incoming, ...combined]))).toEqual(['incoming', 'newer', 'older', 'oldest']);
		expect(combined).toEqual(before);
		expect(combined.at(-1)?.id).toBe('oldest');
	});

	it('accepts the native adapter read watermark without adding a status to received objects', () => {
		const notifications = [release('one', { isRead: undefined }), release('two', { isRead: undefined })];
		const rows = groupZalipReleaseNotifications(notifications, () => true);
		expect(rows).toHaveLength(1);
		for (const notification of notifications) expect(notification.isRead).toBeUndefined();
	});

	it('keeps the existing card key when streaming or pagination extends its group', () => {
		const original = [release('two'), release('one')];
		const first = groupZalipReleaseNotifications(original);
		const streamed = groupZalipReleaseNotifications([release('three'), ...original], undefined, first);
		expect(streamed[0].id).toBe('three');
		expect(streamed[0].key).toBe(first[0].key);
		const paged = groupZalipReleaseNotifications([...streamed[0].members, release('oldest')], undefined, streamed);
		expect(paged[0].key).toBe(first[0].key);
	});

	it('keeps keys unique when a formerly grouped run is split at a read boundary', () => {
		const originals = [release('three'), release('two'), release('one')];
		const first = groupZalipReleaseNotifications(originals);
		const split = groupZalipReleaseNotifications(originals, notification => notification.id !== 'three', first);
		expect(split).toHaveLength(2);
		expect(new Set(split.map(row => row.key)).size).toBe(split.length);
		expect(ids(split)).toEqual(['three', 'two', 'one']);
	});
});
