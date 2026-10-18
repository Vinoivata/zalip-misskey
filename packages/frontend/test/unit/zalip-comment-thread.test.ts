/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import type * as Misskey from 'misskey-js';
import { createCommentReplyPager, createCommentThreadBudget } from '@/utility/zalip-comment-thread.js';

function reply(id: string, patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id, replyId: '000', text: id, ...patch } as Misskey.entities.Note;
}

function page(start = 1): Misskey.entities.Note[] { return Array.from({ length: 10 }, (_, index) => reply(String(start + index).padStart(3, '0'))); }

async function settle(): Promise<void> { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe('lazy direct comment pagination', () => {
	it('does not fetch on creation, only loads on explicit expansion and reuses a collapsed branch', async () => {
		const fetchPage = vi.fn().mockResolvedValue([reply('001')]);
		const pager = createCommentReplyPager({ parentId: '000', accountId: () => 'viewer', fetchPage });
		expect(fetchPage).not.toHaveBeenCalled();
		pager.toggle(); await settle();
		expect(fetchPage).toHaveBeenCalledExactlyOnceWith({ noteId: '000', limit: 10, sinceId: '0' });
		pager.toggle(); pager.toggle(); await settle();
		expect(fetchPage).toHaveBeenCalledTimes(1);
		expect(pager.state.items.map(note => note.id)).toEqual(['001']);
	});
	it('includes a federated reply whose native ID sorts before its parent', async () => {
		const fetchPage = vi.fn().mockResolvedValue([reply('100', { replyId: '900' })]);
		const pager = createCommentReplyPager({ parentId: '900', accountId: () => null, fetchPage });
		await pager.loadNext();
		expect(fetchPage).toHaveBeenCalledExactlyOnceWith({ noteId: '900', limit: 10, sinceId: '0' });
		expect(pager.state.items.map(note => note.id)).toEqual(['100']);
	});
	it('advances the raw server cursor even when the last row is hidden, wrong-parent or a cycle', async () => {
		const rows = page(); rows[9] = reply('010', { replyId: 'foreign' }); rows[1] = reply('002', { isHidden: true }); rows[2] = reply('003', { deletedAt: '2026-10-18T00:00:00Z' });
		const fetchPage = vi.fn().mockResolvedValueOnce(rows).mockResolvedValueOnce([reply('011')]);
		const pager = createCommentReplyPager({ parentId: '000', ancestors: ['004'], accountId: () => null, fetchPage });
		await pager.loadNext();
		expect(pager.state.items.map(note => note.id)).not.toEqual(expect.arrayContaining(['002', '003', '004', '010']));
		await pager.loadNext();
		expect(fetchPage).toHaveBeenLastCalledWith({ noteId: '000', limit: 10, sinceId: '010' });
		expect(pager.state.items.at(-1)?.id).toBe('011');
	});
	it('deduplicates within/across pages without skipping cursor entries', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce([reply('010'), reply('011'), reply('011'), reply('012')]);
		const pager = createCommentReplyPager({ parentId: '000', accountId: () => null, fetchPage });
		await pager.loadNext(); await pager.loadNext();
		expect(pager.state.items).toHaveLength(12);
		expect(new Set(pager.state.items.map(note => note.id)).size).toBe(12);
		expect(pager.state.hasMore).toBe(false);
	});
	it('retains loaded replies/cursor on errors and only retries on user action', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([reply('011')]);
		const pager = createCommentReplyPager({ parentId: '000', accountId: () => null, fetchPage });
		await pager.loadNext(); await pager.loadNext();
		expect(pager.state.error).toBe(true); expect(pager.state.items).toHaveLength(10);
		await settle(); expect(fetchPage).toHaveBeenCalledTimes(2);
		await pager.loadNext();
		expect(fetchPage).toHaveBeenLastCalledWith({ noteId: '000', limit: 10, sinceId: '010' });
		expect(pager.state.error).toBe(false); expect(pager.state.items).toHaveLength(11);
	});
	it('rejects late responses after reset or account change and prevents duplicate in-flight calls', async () => {
		let finish!: (notes: Misskey.entities.Note[]) => void;
		let account = 'a';
		const fetchPage = vi.fn(() => new Promise<Misskey.entities.Note[]>(resolve => { finish = resolve; }));
		const pager = createCommentReplyPager({ parentId: '000', accountId: () => account, fetchPage });
		const load = pager.loadNext(); await pager.loadNext(); expect(fetchPage).toHaveBeenCalledTimes(1);
		account = 'b'; finish([reply('001')]); await load;
		expect(pager.state.items).toEqual([]); expect(pager.state.pending).toBe(false);
		const second = pager.loadNext(); pager.reset(); finish([reply('002')]); await second;
		expect(pager.state.items).toEqual([]); expect(pager.state.expanded).toBe(false);
	});
	it('shares a bounded tree budget across parents and fails closed on blocked/missing children', async () => {
		const budget = createCommentThreadBudget(2);
		budget.take(reply('000'));
		const pager = createCommentReplyPager({ parentId: '000', accountId: () => null, budget, allowNote: note => note.id !== '001', fetchPage: async () => page() });
		await pager.loadNext();
		expect(pager.state.items.map(note => note.id)).toEqual(['002']);
		expect(pager.state.limited).toBe(true); expect(pager.state.hasMore).toBe(false);
	});
	it('stops non-advancing pages and uses only raw rows for the next cursor after a local insert', async () => {
		const fetchPage = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(Array.from({ length: 10 }, () => reply('010')));
		const pager = createCommentReplyPager({ parentId: '000', accountId: () => null, fetchPage });
		pager.toggle(); await settle(); pager.insert(reply('100')); await pager.loadNext();
		expect(fetchPage).toHaveBeenLastCalledWith({ noteId: '000', limit: 10, sinceId: '010' });
		expect(pager.state.items.at(-1)?.id).toBe('100'); expect(pager.state.hasMore).toBe(false);
	});
	it('never inserts private/foreign/deleted rows or renders a closed branch from an event', async () => {
		const pager = createCommentReplyPager({ parentId: '000', accountId: () => null, fetchPage: async () => [] });
		pager.insert(reply('001')); expect(pager.state.items).toEqual([]);
		pager.toggle(); await settle();
		for (const note of [reply('000'), reply('001', { replyId: 'other' }), reply('002', { isHidden: true }), reply('003', { deletedAt: 'now' })]) pager.insert(note);
		expect(pager.state.items).toEqual([]);
		pager.insert(reply('004')); pager.insert(reply('004')); expect(pager.state.items).toHaveLength(1);
		pager.remove('004'); expect(pager.state.items).toEqual([]);
	});
});
