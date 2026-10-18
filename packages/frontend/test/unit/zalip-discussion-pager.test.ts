/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import type * as Misskey from 'misskey-js';
import { createZalipDiscussionPager } from '@/utility/zalip-discussion-pager.js';

function note(id: string, patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id, replyId: 'parent', userId: 'author', text: id, ...patch } as Misskey.entities.Note;
}

function page(first = 60): Misskey.entities.Note[] {
	return Array.from({ length: 30 }, (_, index) => note(String(first - index).padStart(3, '0')));
}

describe('shared post/title/episode discussion pager', () => {
	it('loads only direct visible replies, deduplicates, and takes the next cursor from the raw final row', async () => {
		const raw = page();
		raw[2] = note('058', { isHidden: true });
		raw[3] = note('057', { deletedAt: '2026-10-18T00:00:00Z' });
		raw[29] = note('031', { replyId: 'foreign' });
		const fetchPage = vi.fn().mockResolvedValueOnce(raw).mockResolvedValueOnce([note('030'), note('030'), note('029')]);
		const pager = createZalipDiscussionPager({ accountId: () => 'reader', fetchPage });
		pager.reset('parent');
		expect(fetchPage).not.toHaveBeenCalled();
		await pager.load();
		expect(pager.state.items.map(item => item.id)).not.toEqual(expect.arrayContaining(['058', '057', '031']));
		expect(pager.state.hasMore).toBe(true);
		await pager.load();
		expect(fetchPage).toHaveBeenLastCalledWith({ noteId: 'parent', limit: 30, untilId: '031' });
		expect(pager.state.items.slice(-2).map(item => item.id)).toEqual(['030', '029']);
		expect(pager.state.hasMore).toBe(false);
	});
	it('starts oldest-first at the native minimum cursor, not at the parent timestamp, and sorts local insertions consistently', async () => {
		const fetchPage = vi.fn().mockResolvedValue([note('002'), note('001')]);
		const pager = createZalipDiscussionPager({ accountId: () => null, fetchPage });
		pager.reset('parent', true);
		await pager.load();
		expect(fetchPage).toHaveBeenCalledExactlyOnceWith({ noteId: 'parent', limit: 30, sinceId: '0' });
		pager.insert(note('003')); pager.insert(note('002')); pager.insert(note('parent'));
		expect(pager.state.items.map(item => item.id)).toEqual(['001', '002', '003']);
	});
	it('never derives pagination from an optimistic local insertion or a filtered list', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce([]);
		const pager = createZalipDiscussionPager({ accountId: () => 'reader', fetchPage });
		pager.reset('parent'); await pager.load();
		pager.insert(note('100'));
		await pager.load();
		expect(fetchPage).toHaveBeenLastCalledWith({ noteId: 'parent', limit: 30, untilId: '031' });
		expect(pager.state.items[0].id).toBe('100');
	});
	it('retains the last successful page and cursor on failure and retries only when explicitly called', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([note('030')]);
		const pager = createZalipDiscussionPager({ accountId: () => 'reader', fetchPage });
		pager.reset('parent'); await pager.load(); await pager.load();
		expect(pager.state.error).toBe(true); expect(pager.state.items).toHaveLength(30);
		await Promise.resolve(); expect(fetchPage).toHaveBeenCalledTimes(2);
		await pager.load();
		expect(fetchPage).toHaveBeenLastCalledWith({ noteId: 'parent', limit: 30, untilId: '031' });
		expect(pager.state.error).toBe(false); expect(pager.state.items).toHaveLength(31);
	});
	it('rejects old parent responses without clearing a newer request pending flag', async () => {
		const finishes: Array<(rows: Misskey.entities.Note[]) => void> = [];
		const fetchPage = vi.fn(() => new Promise<Misskey.entities.Note[]>(resolve => { finishes.push(resolve); }));
		const pager = createZalipDiscussionPager({ accountId: () => 'reader', fetchPage });
		pager.reset('parent'); const old = pager.load(); await pager.load();
		expect(fetchPage).toHaveBeenCalledTimes(1);
		pager.reset('next-parent'); const current = pager.load();
		finishes[0]([note('001')]); await old;
		expect(pager.state.pending).toBe(true); expect(pager.state.items).toEqual([]);
		finishes[1]([note('002', { replyId: 'next-parent' })]); await current;
		expect(pager.state.pending).toBe(false); expect(pager.state.items.map(item => item.id)).toEqual(['002']);
	});
	it('rejects old-account data and invalidates an unmounted or reset context', async () => {
		let account = 'old-reader';
		let finish!: (rows: Misskey.entities.Note[]) => void;
		const fetchPage = vi.fn(() => new Promise<Misskey.entities.Note[]>(resolve => { finish = resolve; }));
		const pager = createZalipDiscussionPager({ accountId: () => account, fetchPage });
		pager.reset('parent'); const old = pager.load();
		account = 'new-reader'; finish([note('private-old')]); await old;
		expect(pager.state.items).toEqual([]); expect(pager.state.loaded).toBe(false); expect(pager.state.pending).toBe(false);
		const unmount = pager.load(); pager.reset(''); finish([note('late')]); await unmount;
		expect(pager.state.items).toEqual([]); expect(pager.state.pending).toBe(false);
		await pager.load(); expect(fetchPage).toHaveBeenCalledTimes(2);
	});
	it('stops a repeated non-advancing full page rather than looping requests', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(Array.from({ length: 30 }, () => note('031')));
		const pager = createZalipDiscussionPager({ accountId: () => 'reader', fetchPage });
		pager.reset('parent'); await pager.load(); await pager.load(); await pager.load();
		expect(fetchPage).toHaveBeenCalledTimes(2); expect(pager.state.hasMore).toBe(false);
		expect(new Set(pager.state.items.map(item => item.id)).size).toBe(30);
	});
});
