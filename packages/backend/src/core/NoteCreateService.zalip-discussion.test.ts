/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { NoteCreateService } from './NoteCreateService.js';
import type { MiNote } from '@/models/Note.js';

const author = { id: 'commenter', username: 'commenter', host: null, isBot: false, isCat: false };
const administrator = { id: 'admin', username: 'Admin', host: null, uri: null };
const existingRoot = { id: 'root', name: 'zalip:discussion-root', userId: 'admin', userHost: null, threadId: null, visibility: 'home', localOnly: true, channelId: null } as MiNote;

function override(target: object, key: string, value: unknown) {
	Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

function createHarness(bound: boolean) {
	const service = Object.create(NoteCreateService.prototype) as NoteCreateService;
	const insertNote = vi.fn().mockRejectedValue(new Error('stop-before-persistence'));
	Object.assign(service, {
		db: { query: vi.fn().mockResolvedValue([{ bound }]) },
		meta: { prohibitedWords: [], silencedHosts: [], mediaSilencedHosts: [] },
		utilityService: { isKeyWordIncluded: () => false, isSilencedHost: () => false, isMediaSilencedHost: () => false },
		roleService: { getUserPolicies: async () => ({ mentionLimit: 100 }) },
		usersRepository: { findOneByOrFail: vi.fn().mockResolvedValue(administrator) },
	});
	override(service, 'checkProhibitedWordsContain', () => false);
	override(service, 'insertNote', insertNote);
	return { service, insertNote };
}

function notificationHarness() {
	const service = Object.create(NoteCreateService.prototype) as NoteCreateService;
	const createNotification = vi.fn();
	const publishMainStream = vi.fn();
	const enqueueUserWebhook = vi.fn();
	Object.assign(service, {
		meta: {},
		notesChart: { update: vi.fn() },
		perUserNotesChart: { update: vi.fn() },
		hashtagService: { updateHashtags: vi.fn() },
		antennaService: { addNoteToAntennas: vi.fn() },
		activeUsersChart: { write: vi.fn() },
		userEntityService: { isLocalUser: () => true, isRemoteUser: () => false },
		noteEntityService: { pack: vi.fn().mockResolvedValue({ id: 'comment' }) },
		globalEventService: { publishMainStream, publishNotesStream: vi.fn() },
		roleService: { addNoteToRoleTimeline: vi.fn() },
		webhookService: { enqueueUserWebhook },
		noteThreadMutingsRepository: { exists: vi.fn().mockResolvedValue(false) },
		notificationService: { createNotification },
	});
	for (const method of ['incNotesCountOfUser', 'pushToTl', 'saveReply', 'index']) override(service, method, vi.fn());
	const note = { id: 'comment', visibility: 'home', threadId: 'root' } as MiNote;
	const post = (reply: MiNote, mentionedUsers: typeof administrator[], technicalRoot: boolean) => (service as unknown as {
		postNoteCreated: (note: MiNote, user: typeof author, data: { reply: MiNote; localOnly: boolean; visibility: string }, silent: boolean, tags: string[], mentions: typeof administrator[], technicalRoot: boolean) => Promise<void>;
	}).postNoteCreated(note, author, { reply, localOnly: true, visibility: 'home' }, false, [], mentionedUsers, technicalRoot);
	return { post, createNotification, publishMainStream, enqueueUserWebhook };
}

describe('content comments do not reply to the hidden administrator root', () => {
	it.each([true, false])('only an actual bound technical root suppresses its implicit author mention: %s', async bound => {
		const { service, insertNote } = createHarness(bound);
		await expect(service.create(author, { reply: existingRoot, text: 'A comment on the title', apHashtags: [], apEmojis: [], apMentions: [] })).rejects.toThrow('stop-before-persistence');
		expect(insertNote.mock.calls[0][4]).toEqual(bound ? [] : [administrator]);
	});
	it('keeps an explicit real administrator mention inside a content comment', async () => {
		const { service, insertNote } = createHarness(true);
		await expect(service.create(author, { reply: existingRoot, text: '@Admin Please check this', apHashtags: [], apEmojis: [], apMentions: [administrator] })).rejects.toThrow('stop-before-persistence');
		expect(insertNote.mock.calls[0][4]).toEqual([administrator]);
	});
	it('automatically mentions the real author of a nested comment, even though its thread belongs to content', async () => {
		const { service, insertNote } = createHarness(true);
		const reply = { ...existingRoot, id: 'actual-comment', name: null, threadId: 'root' };
		await expect(service.create(author, { reply, text: 'Answer', apHashtags: [], apEmojis: [], apMentions: [] })).rejects.toThrow('stop-before-persistence');
		expect(insertNote.mock.calls[0][4]).toEqual([administrator]);
	});
	it('does not emit a root-author reply notification, stream event or user webhook', async () => {
		const harness = notificationHarness();
		await harness.post(existingRoot, [], true);
		expect(harness.createNotification).not.toHaveBeenCalled();
		expect(harness.publishMainStream).not.toHaveBeenCalled();
		expect(harness.enqueueUserWebhook).not.toHaveBeenCalledWith('admin', 'reply', expect.anything());
	});
	it('keeps explicit mention notifications to the administrator without converting them to a root reply', async () => {
		const harness = notificationHarness();
		await harness.post(existingRoot, [administrator], true);
		expect(harness.createNotification).toHaveBeenCalledExactlyOnceWith('admin', 'mention', { noteId: 'comment' }, 'commenter');
		expect(harness.publishMainStream).toHaveBeenCalledWith('admin', 'mention', expect.anything());
	});
	it('preserves normal reply notifications to authors of nested comments', async () => {
		const harness = notificationHarness();
		const comment = { ...existingRoot, id: 'actual-comment', name: null, threadId: 'root' };
		await harness.post(comment, [administrator], false);
		expect(harness.createNotification).toHaveBeenCalledExactlyOnceWith('admin', 'reply', { noteId: 'comment' }, 'commenter');
		expect(harness.publishMainStream).toHaveBeenCalledWith('admin', 'reply', expect.anything());
		expect(harness.enqueueUserWebhook).toHaveBeenCalledWith('admin', 'reply', expect.anything());
	});
});
