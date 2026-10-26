/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { entities } from 'misskey-js';

export type ZalipReleaseNotification = Extract<entities.Notification, { type: 'zalipEpisodeReleased' | 'zalipAllohaAvailable' }>;
export type NotificationPresentationRow = {
	key: string;
	id: string;
	createdAt: string;
	notification: entities.Notification;
	/** The exact received objects remain available; this is never a replacement API notification. */
	members: entities.Notification[];
	releaseNotifications?: ZalipReleaseNotification[];
};

function isRelease(notification: entities.Notification): notification is ZalipReleaseNotification {
	return notification.type === 'zalipEpisodeReleased' || notification.type === 'zalipAllohaAvailable';
}

function localDay(createdAt: string): string | null {
	const date = new Date(createdAt);
	return Number.isNaN(date.getTime()) ? null : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Preserve an explicit status from an adapter that supplies one, even though native notifications use a read watermark. */
export function explicitNotificationReadState(notification: entities.Notification): boolean | undefined {
	const state = (notification as entities.Notification & { isRead?: unknown }).isRead;
	return typeof state === 'boolean' ? state : undefined;
}

/** Only adjacent received releases of one kind/title/day/read-state share their presentation. */
export function groupZalipReleaseNotifications(
	notifications: readonly entities.Notification[],
	readState: (notification: entities.Notification) => boolean | undefined = explicitNotificationReadState,
	previousRows: readonly NotificationPresentationRow[] = [],
): NotificationPresentationRow[] {
	const rows: NotificationPresentationRow[] = [];
	for (const notification of notifications) {
		const previous = rows.at(-1);
		const day = localDay(notification.createdAt);
		const state = readState(notification);
		if (isRelease(notification) && previous?.releaseNotifications && isRelease(previous.notification)
			&& previous.notification.type === notification.type && previous.notification.workId === notification.workId
			&& day != null && localDay(previous.createdAt) === day && state != null && readState(previous.notification) === state) {
			previous.releaseNotifications.push(notification);
			continue;
		}
		const releases = isRelease(notification) ? [notification] : undefined;
		rows.push({ key: notification.id, id: notification.id, createdAt: notification.createdAt, notification, members: releases ?? [notification], releaseNotifications: releases });
	}
	// Extending a group must update its existing card, retaining focused event
	// links instead of remounting the whole row whenever its newest event changes.
	const priorKeys = new Map(previousRows.flatMap(row => row.members.map(member => [member.id, row.key] as const)));
	const usedKeys = new Set<string>();
	for (const row of rows) {
		const retained = row.members.map(member => priorKeys.get(member.id)).find(key => key != null && !usedKeys.has(key));
		let key = retained ?? row.id;
		let suffix = 0;
		while (usedKeys.has(key)) key = `${row.id}:${++suffix}`;
		row.key = key;
		usedKeys.add(key);
	}
	return rows;
}
