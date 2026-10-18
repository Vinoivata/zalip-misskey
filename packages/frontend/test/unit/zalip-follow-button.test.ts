/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type * as Misskey from 'misskey-js';
import MkZalipFollowButton from '@/components/MkZalipFollowButton.vue';
import { i18n } from '@/i18n.js';

const controls = vi.hoisted(() => ({ api: vi.fn(), confirm: vi.fn(), alert: vi.fn(), login: vi.fn(), channel: vi.fn(), account: { id: 'viewer', token: 'fixture-token', followingCount: 1 }, preferences: { alwaysConfirmFollow: false, defaultFollowWithReplies: true } }));
vi.mock('@/i.js', async () => { const { reactive } = await import('vue'); return { $i: reactive(controls.account) }; });
vi.mock('@/preferences.js', () => ({ prefer: { s: controls.preferences } }));
vi.mock('@/os.js', () => ({ confirm: controls.confirm, alert: controls.alert }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: controls.api }));
vi.mock('@/utility/please-login.js', () => ({ pleaseLogin: controls.login }));
vi.mock('@/utility/haptic.js', () => ({ haptic: vi.fn() }));
vi.mock('@/utility/achievements.js', () => ({ claimAchievement: vi.fn() }));
vi.mock('@/stream.js', () => ({ useStream: () => ({ useChannel: controls.channel }) }));

type Relation = { id: string; isFollowing: boolean; hasPendingFollowRequestFromYou: boolean; isBlocking: boolean; isBlocked: boolean };
const row = (id: string, patch: Partial<Relation> = {}): Relation => ({ id, isFollowing: false, hasPendingFollowRequestFromYou: false, isBlocking: false, isBlocked: false, ...patch });
const user = (id = 'author') => ({ id, name: 'Author', username: id, host: null } as Misskey.entities.UserLite);
let observers: Array<{ callback: IntersectionObserverCallback; target: Element | null; options?: IntersectionObserverInit }>;
let channels: Array<{ handlers: Map<string, (user: Misskey.entities.UserLite) => void>; dispose: ReturnType<typeof vi.fn> }>;
let relations: Map<string, Relation>;
let counter = 0;
async function settle(): Promise<void> { for (let i = 0; i < 16; i++) { await Promise.resolve(); await nextTick(); } }
function enter(index = observers.length - 1, value = true): void { const item = observers[index]; item.callback([{ target: item.target, isIntersecting: value, intersectionRatio: value ? 1 : 0 } as IntersectionObserverEntry], {} as IntersectionObserver); }

beforeEach(() => {
	vi.clearAllMocks(); observers = []; channels = []; relations = new Map(); controls.account.id = `viewer-${++counter}`; controls.account.token = `fixture-token-${counter}`;
	controls.preferences.alwaysConfirmFollow = false; controls.preferences.defaultFollowWithReplies = true;
	controls.confirm.mockResolvedValue({ canceled: false }); controls.alert.mockResolvedValue(undefined); controls.login.mockResolvedValue(false);
	controls.api.mockImplementation(async (endpoint: string, data: { userId: string | string[] }) => {
		if (endpoint === 'users/relation') return (data.userId as string[]).map(id => relations.get(id) ?? row(id));
		const id = data.userId as string;
		if (endpoint === 'following/create') relations.set(id, row(id, { isFollowing: true }));
		if (endpoint === 'following/delete' || endpoint === 'following/requests/cancel') relations.set(id, row(id));
		return user(id); // Native write responses are deliberately not relation DTOs.
	});
	controls.channel.mockImplementation(() => { const channel = { handlers: new Map(), dispose: vi.fn() }; channels.push(channel); return { on: (event: string, callback: (value: Misskey.entities.UserLite) => void) => channel.handlers.set(event, callback), dispose: channel.dispose }; });
	vi.stubGlobal('IntersectionObserver', class {
		private item: typeof observers[number];
		constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) { this.item = { callback, target: null, options }; observers.push(this.item); }
		observe(element: Element): void { this.item.target = element; }
		disconnect(): void { /* Stale callback replay is intentional in regressions. */ }
	});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('compact native author follow actions', () => {
	it('loads only viewport demand, batches authors and shares one main-channel subscription', async () => {
		const Host = defineComponent({ setup: () => () => h('div', [h(MkZalipFollowButton, { user: user('a') }), h(MkZalipFollowButton, { user: user('a') }), h(MkZalipFollowButton, { user: user('b') })]) });
		const view = render(Host); await settle(); expect(controls.api).not.toHaveBeenCalled();
		expect(observers[0].options).toEqual({ rootMargin: '0px', threshold: 0.01 });
		for (let i = 0; i < 3; i++) enter(i); await settle();
		expect(controls.api).toHaveBeenCalledTimes(1); expect(controls.api.mock.calls[0].slice(0, 3)).toEqual(['users/relation', { userId: ['a', 'b'] }, controls.account.token]);
		expect(view.getAllByRole('button', { name: i18n.ts.follow })).toHaveLength(3); expect(controls.channel).toHaveBeenCalledTimes(1);
		view.unmount(); expect(channels[0].dispose).toHaveBeenCalledTimes(1);
	});
	it('follows using native preferences and a captured token, then refreshes authoritative state', async () => {
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.follow })); await settle();
		expect(controls.api.mock.calls.find(call => call[0] === 'following/create')).toEqual(['following/create', { userId: 'author', withReplies: true }, controls.account.token]);
		expect(view.getByRole('button', { name: i18n.ts.youFollowing })).toBeTruthy();
		expect(controls.api.mock.calls.filter(call => call[0] === 'users/relation')).toHaveLength(3); expect(controls.api.mock.calls.some(call => call[0] === 'users/show')).toBe(false);
	});
	it.each([['following/delete', { isFollowing: true }, 'youFollowing'], ['following/requests/cancel', { hasPendingFollowRequestFromYou: true }, 'followRequestPending']] as const)('handles %s with native confirmation instead of toggling a local flag', async (endpoint, patch, key) => {
		relations.set('author', row('author', patch));
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts[key] })); await settle();
		expect(controls.confirm).toHaveBeenCalledTimes(1); expect(controls.api.mock.calls.some(call => call[0] === endpoint)).toBe(true);
		expect(view.getByRole('button', { name: i18n.ts.follow })).toBeTruthy();
	});
	it('keeps pending requests authoritative even when native create returns only a user', async () => {
		const original = controls.api.getMockImplementation()!;
		controls.api.mockImplementation(async (...args: unknown[]) => {
			if (args[0] === 'following/create') { relations.set('author', row('author', { hasPendingFollowRequestFromYou: true })); return user(); }
			return original(...args);
		});
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.follow })); await settle();
		expect(view.getByRole('button', { name: i18n.ts.followRequestPending })).toBeTruthy();
	});
	it('deduplicates author writes across repeated buttons and cancels on unconfirmed action', async () => {
		let confirm!: (value: { canceled: boolean }) => void;
		controls.preferences.alwaysConfirmFollow = true; controls.confirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
		const Host = defineComponent({ setup: () => () => h('div', [h(MkZalipFollowButton, { user: user() }), h(MkZalipFollowButton, { user: user() })]) });
		const view = render(Host); await settle(); enter(0); enter(1); await settle();
		await fireEvent.click(view.getAllByRole('button', { name: i18n.ts.follow })[0]); await settle();
		expect(view.getAllByRole('button').every(button => (button as HTMLButtonElement).disabled)).toBe(true);
		confirm({ canceled: true }); await settle(); expect(controls.api.mock.calls.some(call => call[0].startsWith('following/'))).toBe(false);
	});
	it.each(['account', 'target', 'unmount'] as const)('never sends a mutation after %s changes while confirmation is pending', async context => {
		let confirm!: (value: { canceled: boolean }) => void;
		controls.preferences.alwaysConfirmFollow = true; controls.confirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.follow })); await settle();
		if (context === 'account') { controls.account.id = 'changed-viewer'; controls.account.token = 'changed-fixture-token'; }
		if (context === 'target') await view.rerender({ user: user('other') });
		if (context === 'unmount') view.unmount();
		await settle(); confirm({ canceled: false }); await settle();
		expect(controls.api.mock.calls.some(call => call[0].startsWith('following/'))).toBe(false); expect(controls.alert).not.toHaveBeenCalled();
	});
	it('invalidates native follows performed elsewhere without per-button listeners', async () => {
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		relations.set('author', row('author', { isFollowing: true })); channels[0].handlers.get('follow')!(user()); await settle();
		expect(view.getByRole('button', { name: i18n.ts.youFollowing })).toBeTruthy(); expect(controls.channel).toHaveBeenCalledTimes(1);
	});
	it('does not perform the old action when a native stream update changes its relation during confirmation', async () => {
		let confirm!: (value: { canceled: boolean }) => void;
		controls.preferences.alwaysConfirmFollow = true; controls.confirm.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.follow })); await settle();
		relations.set('author', row('author', { isFollowing: true })); channels[0].handlers.get('follow')!(user()); await settle();
		confirm({ canceled: false }); await settle();
		expect(controls.api.mock.calls.some(call => call[0].startsWith('following/'))).toBe(false); expect(view.getByRole('button', { name: i18n.ts.youFollowing })).toBeTruthy();
	});
	it('revalidates after all buttons were offscreen, when no main listener could observe a native follow', async () => {
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		enter(0, false); await settle(); expect(channels[0].dispose).toHaveBeenCalledTimes(1);
		relations.set('author', row('author', { isFollowing: true })); enter(); await settle();
		expect(view.getByRole('button', { name: i18n.ts.youFollowing })).toBeTruthy(); expect(controls.api).toHaveBeenCalledTimes(2);
	});
	it('shows retry on unavailable relations and never guesses a follow state or auto-retries', async () => {
		controls.api.mockRejectedValueOnce(new Error('offline'));
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		expect(controls.api).toHaveBeenCalledTimes(1); await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle();
		expect(view.getByRole('button', { name: i18n.ts.follow })).toBeTruthy(); expect(controls.api.mock.calls.some(call => call[0].startsWith('following/'))).toBe(false);
	});
	it('offers an explicit read-only retry without IntersectionObserver rather than eager loading', async () => {
		vi.stubGlobal('IntersectionObserver', undefined);
		const view = render(MkZalipFollowButton, { props: { user: user() } }); await settle();
		expect(controls.api).not.toHaveBeenCalled(); await fireEvent.click(view.getByRole('button', { name: i18n.ts.retry })); await settle();
		expect(view.getByRole('button', { name: i18n.ts.follow })).toBeTruthy(); expect(controls.api.mock.calls.map(call => call[0])).toEqual(['users/relation']);
	});
	it('hides self, denies blocked state, and does not query mock stories', async () => {
		const self = render(MkZalipFollowButton, { props: { user: user(controls.account.id) } }); await settle(); expect(self.queryByRole('button')).toBeNull(); self.unmount();
		relations.set('author', row('author', { isBlocking: true })); const blocked = render(MkZalipFollowButton, { props: { user: user() } }); await settle(); enter(); await settle();
		expect((blocked.getByRole('button', { name: i18n.ts.blocked }) as HTMLButtonElement).disabled).toBe(true); blocked.unmount();
		controls.api.mockClear(); const mock = render(MkZalipFollowButton, { props: { user: user(), mock: true } }); await settle(); expect(controls.api).not.toHaveBeenCalled(); expect((mock.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
	});
});
