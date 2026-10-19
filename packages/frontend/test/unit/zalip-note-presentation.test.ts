/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/vue';
import { defineComponent, h, nextTick } from 'vue';
import type * as Misskey from 'misskey-js';
import MkNote from '@/components/MkNote.vue';
import MkNoteDetailed from '@/components/MkNoteDetailed.vue';
import MkNoteHeader from '@/components/MkNoteHeader.vue';
import MkNoteSub from '@/components/MkNoteSub.vue';
import noteSource from '@/components/MkNote.vue?raw';
import detailedSource from '@/components/MkNoteDetailed.vue?raw';
import { i18n } from '@/i18n.js';

const actions = vi.hoisted(() => ({ react: vi.fn(), toggleReact: vi.fn(), renote: vi.fn(), reply: vi.fn(), showMenu: vi.fn(), showRenoteMenu: vi.fn(), push: vi.fn(), share: vi.fn(), previewVisible: false, viewBindings: [] as Array<{ target: { readonly value: HTMLElement | null }; enabled: () => boolean }> }));
// Vitest's disabled-CSS module proxy stringifies Symbols during circular SFC
// imports. Keep class names available to these DOM tests without loading CSS.
vi.mock('@/components/MkNote.vue?vue&type=style&index=0&lang.module.scss', () => ({ default: new Proxy({}, { get: (_, key) => typeof key === 'string' ? `note_${key}` : undefined }) }));
vi.mock('@/components/MkNoteDetailed.vue?vue&type=style&index=0&lang.module.scss', () => ({ default: new Proxy({}, { get: (_, key) => typeof key === 'string' ? `detail_${key}` : undefined }) }));
vi.mock('@/components/MkNoteHeader.vue?vue&type=style&index=0&lang.module.scss', () => ({ default: new Proxy({}, { get: (_, key) => typeof key === 'string' ? `header_${key}` : undefined }) }));
vi.mock('@/components/MkNoteSub.vue?vue&type=style&index=0&lang.module.scss', () => ({ default: new Proxy({}, { get: (_, key) => typeof key === 'string' ? `sub_${key}` : undefined }) }));
vi.mock('@/i.js', () => ({ $i: null }));
vi.mock('@/router.js', () => ({ useRouter: () => ({ push: actions.push }) }));
vi.mock('@/os.js', () => ({ popup: vi.fn() }));
vi.mock('@/utility/url-preview.js', () => ({ isEnabledUrlPreview: true }));
vi.mock('@/utility/misskey-api.js', () => ({ misskeyApi: vi.fn().mockResolvedValue([]) }));
vi.mock('@/utility/zalip-note-share.js', () => ({ openZalipNoteShare: actions.share }));
vi.mock('@/composables/use-zalip-note-views.js', async () => {
	const { computed } = await import('vue');
	return { useZalipNoteViews: (target: { readonly value: HTMLElement | null }, note: () => Misskey.entities.Note, enabled: () => boolean) => {
		actions.viewBindings.push({ target, enabled });
		return computed(() => note().zalipViewCount);
	} };
});
vi.mock('@/composables/use-note.js', async () => {
	const { ref, reactive } = await import('vue');
	return { useNote: (props: { note: Misskey.entities.Note }) => {
		const isRenote = !!props.note.renote && props.note.text == null && (props.note.files?.length ?? 0) === 0 && props.note.poll == null;
		const appearNote = isRenote ? props.note.renote! : props.note;
		return { note: props.note, appearNote, $appearNote: reactive(appearNote), hideByPlugin: ref(false), isRenote, showContent: ref(false), isDeleted: ref(false), translating: ref(false), translation: ref(null), muted: ref(false), hardMuted: ref(false), collapsed: ref(true), renoteCollapsed: ref(false), parsed: ref(null), urls: ref(['https://example.org/fixture']), showTicker: ref(false), canRenote: ref(appearNote.visibility !== 'specified'), isMyRenote: ref(false), renote: actions.renote, reply: actions.reply, react: actions.react, reactViaMfmEmoji: vi.fn(), toggleReact: actions.toggleReact, onContextmenu: vi.fn(), showMenu: actions.showMenu, clip: vi.fn(), showRenoteMenu: actions.showRenoteMenu, blur: vi.fn() };
	} };
});
vi.mock('@/components/MkMediaList.vue', () => ({ default: { template: '<div data-testid="note-media">Fixture media</div>' } }));
vi.mock('@/components/MkPoll.vue', () => ({ default: { template: '<button type="button" data-testid="note-poll">Fixture poll</button>' } }));
vi.mock('@/components/MkUrlPreview.vue', () => ({ default: { template: '<a href="https://example.org/fixture" data-testid="note-url">Fixture URL</a>' } }));
vi.mock('@/components/MkNoteSimple.vue', () => ({ default: { template: '<div data-testid="note-quote">Fixture quote</div>' } }));
vi.mock('@/components/ZalipShareCard.vue', () => ({ default: { template: '<a href="/zalip/fixture" data-testid="note-share">Fixture title card</a>' } }));
vi.mock('@/components/ZalipCommentForm.vue', () => ({ default: { template: '<div />' } }));
vi.mock('@/components/MkCwButton.vue', () => ({ default: { props: ['modelValue'], emits: ['update:modelValue'], template: '<button type="button" @click="$emit(\'update:modelValue\', !modelValue)">Toggle CW</button>' } }));
vi.mock('@/components/MkReactionIcon.vue', () => ({ default: { props: ['reaction'], template: '<span data-testid="reaction-emoji">{{ reaction }}</span>' } }));
vi.mock('@/components/MkZalipBookmark.vue', () => ({ default: { props: ['noteId'], template: '<button type="button" aria-label="Fixture bookmark" :data-note-id="noteId" />' } }));
vi.mock('@/components/MkZalipReplyPreview.vue', async () => {
	const { defineComponent, h, onMounted } = await import('vue');
	return { default: defineComponent({ emits: ['visible'], setup: (_, { emit }) => {
		onMounted(() => { if (actions.previewVisible) emit('visible', true); });
		return () => h('div', { 'data-testid': 'reply-preview' });
	} }) };
});

function note(patch: Partial<Misskey.entities.Note> = {}): Misskey.entities.Note {
	return { id: 'fixture-note', createdAt: '2026-10-18T00:00:00Z', deletedAt: null, text: 'Fixture post', cw: null, userId: 'fixture-author', user: { id: 'fixture-author', name: 'Fixture Author', username: 'author', host: null, isBot: false, avatarUrl: null, avatarBlurhash: null, avatarDecorations: [], emojis: {}, onlineStatus: 'unknown', badgeRoles: [] }, visibility: 'public', reactionAcceptance: 'nonSensitiveOnly', reactionEmojis: {}, reactions: { '🔥': 7 }, myReaction: '🔥', reactionCount: 7, repliesCount: 3, renoteCount: 2, files: [], ...patch } as Misskey.entities.Note;
}

const stubs = {
	I18n: defineComponent({ props: { src: String }, setup: (props, { slots }) => () => h('span', { 'data-i18n': props.src }, slots.user?.()) }),
	Mfm: defineComponent({ props: { text: String }, setup: props => () => h('span', { 'data-testid': 'mfm' }, props.text) }),
	MkA: defineComponent({ props: { to: String }, setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) }),
	MkAvatar: defineComponent({ setup: () => () => h('span', { 'data-testid': 'avatar' }) }),
	MkUserName: defineComponent({ props: { user: Object }, setup: props => () => h('span', String(props.user?.name)) }),
	MkAcct: defineComponent({ props: { user: Object }, setup: props => () => h('span', `@${props.user?.username}`) }),
	MkTime: defineComponent({ setup: () => () => h('span', '1h') }),
	MkInstanceTicker: true,
	MkPagination: true,
	MkLoading: true,
};

function setup(component: typeof MkNote | typeof MkNoteDetailed | typeof MkNoteHeader | typeof MkNoteSub, fixture = note(), props: Record<string, unknown> = {}) {
	return render(component, { props: { note: fixture, ...props }, global: { stubs, directives: { hotkey: {}, 'user-preview': {}, tooltip: {} } } });
}

beforeEach(() => { vi.clearAllMocks(); actions.previewVisible = false; actions.viewBindings = []; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Zalip compact note presentation', () => {
	it('renders a bound technical root as its cinema title without an administrator header', () => {
		const context = { workId: 'work', slug: 'cinema-title', title: 'Canonical cinema title', posterPath: null, rootNoteId: 'root', isRoot: true, episodeId: null, episodeNumber: null, seasonNumber: null };
		const view = setup(MkNoteDetailed, note({ id: 'root', isZalipDiscussionRoot: true, zalipDiscussion: context }));
		expect(view.getByRole('link', { name: /Canonical cinema title/u }).getAttribute('href')).toBe('/zalip/cinema-title#discussion');
		expect(view.queryByText('Fixture Author')).toBeNull();
		expect(view.queryByRole('button', { name: i18n.ts.more })).toBeNull();
	});

	it.each([MkNote, MkNoteDetailed])('uses a native click target for the repost menu, including keyboard activation in %s', async component => {
		const original = note();
		const view = setup(component, note({ id: 'repost', text: null, renoteId: original.id, renote: original }));
		const menu = view.getByRole('button', { name: i18n.ts.renoteDetails });
		expect(menu.getAttribute('type')).toBe('button');
		menu.focus(); expect(document.activeElement).toBe(menu);
		// Keyboard activation dispatches the native button click without mousedown.
		await fireEvent.click(menu, { detail: 0 });
		expect(actions.showRenoteMenu).toHaveBeenCalledTimes(1);
		expect(actions.showMenu).not.toHaveBeenCalled();
	});
	it('limits read-more to text and never clips media, title shares, polls, URLs or quotes', async () => {
		const fixture = note({ text: 'Long fixture text. '.repeat(50), files: [{ id: 'image' } as Misskey.entities.DriveFile], poll: { multiple: false, expiresAt: null, choices: [] }, renoteId: 'quoted', renote: note({ id: 'quoted' }), zalipShare: { slug: 'fixture', title: 'Fixture', kind: 'movie', description: null, releaseYear: null, genres: [], posterPath: null } });
		const view = setup(MkNote, fixture);
		const collapsed = view.container.querySelector('[class*="contentCollapsed"]');
		expect(collapsed).not.toBeNull();
		for (const name of ['note-media', 'note-poll', 'note-share', 'note-url', 'note-quote']) expect(collapsed!.contains(view.getByTestId(name))).toBe(false);
		const expand = view.getByRole('button', { name: i18n.ts.showMore });
		expect(expand.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(expand);
		expect(view.container.querySelector('[class*="contentCollapsed"]')).toBeNull();
		expect(view.getByRole('button', { name: i18n.ts.showLess }).getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.showLess }));
		expect(view.container.querySelector('[class*="contentCollapsed"]')).not.toBeNull();
		expect(actions.push).not.toHaveBeenCalled();
	});
	it('does not offer a misleading text expander for attachment-only posts', () => {
		const view = setup(MkNote, note({ text: null, files: Array.from({ length: 5 }, (_, index) => ({ id: String(index) }) as Misskey.entities.DriveFile) }));
		expect(view.queryByRole('button', { name: i18n.ts.showMore })).toBeNull();
		expect(view.container.querySelector('[class*="contentCollapsed"]')).toBeNull();
		expect(view.getByTestId('note-media')).toBeTruthy();
	});
	it('keeps native CW conceal/reveal independent from text expansion', async () => {
		const view = setup(MkNote, note({ cw: 'Content warning', text: 'Hidden fixture', files: [{ id: 'image' } as Misskey.entities.DriveFile] }));
		const hiddenContent = view.getByTestId('note-media').parentElement?.parentElement;
		expect(hiddenContent?.style.display).toBe('none');
		expect(view.queryByRole('button', { name: i18n.ts.showMore })).toBeNull();
		await fireEvent.click(view.getByRole('button', { name: 'Toggle CW' }));
		expect(hiddenContent?.style.display).not.toBe('none');
	});
	it.each([MkNote, MkNoteDetailed])('keeps useful action order, separate counts and native handlers without a redundant share control in %s', async component => {
		const view = setup(component);
		const article = view.container.querySelector('article')!;
		const footer = article.querySelector('footer')!;
		const controls = [...footer.querySelectorAll('button, a[aria-label]')];
		expect(controls.map(control => control.getAttribute('aria-label'))).toEqual([i18n.ts.reaction, i18n.ts.reactions, i18n.ts.zalip.comments, i18n.ts.renote, 'Fixture bookmark']);
		expect(controls[0].getAttribute('aria-pressed')).toBe('true');
		expect(controls[1].textContent).toBe('7');
		expect(controls[2].textContent).toContain('3');
		expect(controls[3].textContent).toContain('2');
		expect(controls[4].getAttribute('data-note-id')).toBe('fixture-note');
		await fireEvent.click(controls[0]);
		await fireEvent.click(controls[3]);
		expect(actions.toggleReact).toHaveBeenCalledTimes(1);
		expect(actions.renote).toHaveBeenCalledTimes(1);
		expect(view.queryByRole('button', { name: i18n.ts.share })).toBeNull();
		expect(actions.share).not.toHaveBeenCalled();
		expect(view.getByText('Fixture Author')).toBeTruthy();
		expect(view.getByText('@author')).toBeTruthy();
	});
	it.each([MkNote, MkNoteDetailed])('opens the reaction audience without adding/removing a reaction in %s', async component => {
		const view = setup(component);
		const count = view.container.querySelector<HTMLElement>('article footer [class*="reactionCount"]')!;
		if (component === MkNote) {
			expect(count.tagName).toBe('A');
			expect(count.getAttribute('href')).toBe('/notes/fixture-note/reactions');
			count.addEventListener('click', event => event.preventDefault());
		} else {
			expect(count.tagName).toBe('BUTTON');
		}
		await fireEvent.click(count);
		expect(actions.toggleReact).not.toHaveBeenCalled(); expect(actions.react).not.toHaveBeenCalled();
		if (component === MkNoteDetailed) {
			expect(view.getByRole('heading', { name: i18n.ts.reactions })).toBeTruthy();
			expect((view.getByRole('combobox', { name: i18n.ts.zalip.discussion }) as HTMLSelectElement).value).toBe('reactions');
		}
	});
	it.each([MkNote, MkNoteDetailed])('shows an existing view aggregate as noninteractive text and never invents missing counts in %s', component => {
		const view = setup(component, note({ zalipViewCount: 0 }));
		const counter = view.container.querySelector<HTMLElement>('article footer [class*="viewCount"]')!;
		expect(counter.tagName).toBe('SPAN');
		expect(counter.textContent).toContain('0');
		expect(counter.getAttribute('aria-label')).toBe(`${i18n.ts.zalip.postViews}: 0`);
		expect(counter.closest('button, a, [role="button"]')).toBeNull();
		cleanup();
		expect(setup(component, note({ zalipViewCount: undefined })).container.querySelector('[class*="viewCount"]')).toBeNull();
	});
	it.each([MkNote, MkNoteDetailed])('binds dwell to the actual article and disables it until CW content is revealed in %s', async component => {
		const view = setup(component, note({ cw: 'Content warning' }));
		await nextTick();
		const binding = actions.viewBindings[0];
		expect(binding.target.value?.tagName).toBe('ARTICLE');
		expect(binding.enabled()).toBe(false);
		await fireEvent.click(view.getByRole('button', { name: 'Toggle CW' }));
		expect(binding.enabled()).toBe(true);
	});
	it('keeps a visual post rail on ordinary cards while only marking actual parent context', () => {
		const plain = setup(MkNote);
		expect(plain.container.querySelector('[class*="sub_thread"]')).toBeNull();
		expect(noteSource).toContain('.threadContent::after');
		expect(noteSource).toContain('left: -32px;');
		cleanup();
		const reply = setup(MkNote, note({ replyId: 'parent', reply: note({ id: 'parent', text: 'Parent fixture' }) }));
		expect(reply.getByText('Parent fixture')).toBeTruthy();
		expect(reply.container.querySelector('[class*="sub_thread"]')).not.toBeNull();
	});
	it('places real reply previews before the actions and binds their caret to the actual comment button', async () => {
		const plain = setup(MkNote);
		expect(plain.container.querySelector('.note_hasReplyPreview')).toBeNull();
		cleanup();
		actions.previewVisible = true;
		const view = setup(MkNote);
		await fireEvent.update(view.container);
		expect(view.container.querySelector('.note_hasReplyPreview')).toBeTruthy();
		const bubble = view.getByTestId('reply-preview');
		const footer = view.container.querySelector('footer')!;
		expect(bubble.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(noteSource).toContain(':replyAnchor="commentButton"');
	});
	it.each([MkNote, MkNoteDetailed])('renders the actual reposted comment and attachment instead of a parent-root preview in %s', component => {
		const parent = note({ id: 'discussion-root', text: 'Обсуждение: Test title', isZalipDiscussionRoot: true });
		const comment = note({ id: 'actual-comment', text: 'The comment the user reposted', replyId: parent.id, reply: parent, files: [{ id: 'comment-image' } as Misskey.entities.DriveFile] });
		const wrapper = note({ id: 'repost-wrapper', text: null, renoteId: comment.id, renote: comment, files: [] });
		wrapper.user = { ...wrapper.user, id: 'reposter', name: 'Reposter', username: 'reposter' };
		const view = setup(component, wrapper);
		expect(view.getByText(comment.text!)).toBeTruthy();
		expect(view.getByTestId('note-media')).toBeTruthy();
		expect(view.container.querySelector('[data-i18n]')?.getAttribute('data-i18n')).toBe(i18n.ts.zalip.commentRenotedBy);
		const context = view.getByText(parent.text!).closest('a');
		expect(context?.getAttribute('href')).toBe('/notes/discussion-root');
		expect(view.container.querySelector('[class*="sub_thread"]')).toBeNull();
		expect(view.container.querySelector('.ti-arrow-back-up')).toBeNull();
	});
	it.each([MkNote, MkNoteDetailed])('uses a neutral context label without leaking CW, hidden parent text or inventing content ancestry in %s', component => {
		for (const parent of [note({ id: 'parent', text: 'Secret parent', cw: 'CW', isZalipDiscussionRoot: true }), note({ id: 'parent', text: 'Secret parent', isHidden: true, isZalipDiscussionRoot: true }), note({ id: 'parent', text: 'Ordinary reply, not a content marker' })]) {
			const comment = note({ id: 'comment', text: 'Visible comment', replyId: parent.id, reply: parent });
			const view = setup(component, note({ text: null, renoteId: comment.id, renote: comment }));
			expect(view.getByText(i18n.ts.zalip.commentContext).closest('a')?.getAttribute('href')).toBe('/notes/parent');
			expect(view.queryByText(parent.text!)).toBeNull();
			view.unmount();
		}
	});
	it('matches the measured Notr visual sizes without reducing touch targets or exposing federation metadata', () => {
		expect(noteSource).toMatch(/\.avatar\s*\{[^}]*width: 40px;[^}]*height: 40px;/u);
		for (const source of [noteSource, detailedSource]) {
			expect(source).toContain('> svg { width: 20px; height: 20px; }');
			expect(source).toContain('flex: 0 0 44px;');
			expect(source).not.toContain('MkInstanceTicker');
			expect(source).not.toContain('disableFederation');
		}
		const view = setup(MkNoteHeader, note({ localOnly: true, visibility: 'followers' }), { stacked: true });
		expect(view.container.querySelector('.ti-rocket-off')).toBeNull();
		expect(view.container.querySelector('.ti-lock')).toBeTruthy();
	});
	it.each([MkNote, MkNoteDetailed])('keeps zero counts visible and the private renote action disabled in %s', component => {
		const view = setup(component, note({ reactions: {}, reactionCount: 0, myReaction: null, repliesCount: 0, renoteCount: 0, visibility: 'specified' }));
		const footer = view.container.querySelector('article footer')!;
		const toggle = footer.querySelector('button[aria-pressed]')!;
		const count = footer.querySelector('[class*="reactionCount"]')!;
		const comments = footer.querySelector(`[aria-label="${i18n.ts.zalip.comments}"]`)!;
		const renote = footer.querySelector<HTMLButtonElement>(`[aria-label="${i18n.ts.renote}"]`)!;
		expect(count.textContent).toBe('0');
		expect(comments.textContent).toContain('0');
		expect(renote.disabled).toBe(true);
		expect(toggle.getAttribute('aria-pressed')).toBe('false');
	});
	it('keeps profile/time metadata semantic, including private visibility and long names', () => {
		const fixture = note({ visibility: 'followers' }); fixture.user.name = 'Long author name '.repeat(15);
		const view = setup(MkNoteHeader, fixture, { stacked: true });
		expect(view.getByText(fixture.user.name!.trim())).toBeTruthy();
		expect(view.getByText('@author')).toBeTruthy();
		expect(view.getByText('1h').closest('a')?.getAttribute('href')).toContain('fixture-note');
		expect(view.container.querySelector('.ti-lock')).toBeTruthy();
	});
	it('does not let media controls or read-more trigger delayed parent navigation', async () => {
		vi.useFakeTimers();
		const view = setup(MkNote, note({ text: 'Long fixture. '.repeat(80), poll: { multiple: false, expiresAt: null, choices: [] } }));
		await fireEvent.click(view.getByTestId('note-poll'));
		await fireEvent.click(view.getByRole('button', { name: i18n.ts.showMore }));
		await vi.advanceTimersByTimeAsync(350);
		expect(actions.push).not.toHaveBeenCalled();
	});
});
