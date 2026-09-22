/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createZalipPostNavigation, shouldOpenZalipPost } from '@/utility/zalip-post-navigation.js';

afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges(); vi.useRealTimers(); });

function click(markup = '<span>Post text</span>', options: MouseEventInit = {}, start?: { x: number; y: number }) {
	const article = document.createElement('article');
	article.innerHTML = markup;
	document.body.append(article);
	let opens = false;
	article.addEventListener('click', event => { opens = shouldOpenZalipPost(event, article, start); });
	article.querySelector('*')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...options }));
	return opens;
}

describe('Zalip post navigation', () => {
	it('opens plain post text', () => expect(click()).toBe(true));
	it.each(['a', 'button', 'img', 'video', 'audio', 'input', 'select', 'textarea', 'label', 'summary', 'iframe', 'canvas'])(
		'preserves %s interactions', tag => expect(click(`<${tag}>Control</${tag}>`)).toBe(false),
	);
	it.each(['role="button"', 'role="link"', 'tabindex="0"', 'contenteditable="true"'])(
		'preserves custom controls: %s', attribute => expect(click(`<div ${attribute}>Control</div>`)).toBe(false),
	);
	it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { detail: 2 }])(
		'ignores modified or repeated clicks %j', options => expect(click(undefined, options)).toBe(false),
	);
	it('ignores a click following a swipe', () => expect(click(undefined, { clientX: 90, clientY: 20 }, { x: 15, y: 20 })).toBe(false));
	it('does not swallow text selection', () => {
		const text = document.createTextNode('Selected');
		document.body.append(text);
		const range = document.createRange();
		range.selectNode(text);
		window.getSelection()?.addRange(range);
		expect(click()).toBe(false);
	});
	it('does not open the parent when a nested post is clicked', () => expect(click('<article>Quoted post</article>')).toBe(false));
	it.each(['<ul><li><span>Poll option</span></li></ul>', '<div><span>Quoted post</span></div>', '<span>Media control</span>'])(
		'preserves non-semantic interactive subtrees: %s', markup => {
			const article = document.createElement('article');
			article.innerHTML = `<div data-zalip-post-interactive>${markup}</div>`;
			document.body.append(article);
			let opens = false;
			article.addEventListener('click', event => { opens = shouldOpenZalipPost(event, article); });
			article.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			expect(opens).toBe(false);
		},
	);
	it('does not treat the focusable outer note as an inner control', () => {
		const wrapper = document.createElement('div');
		wrapper.tabIndex = 0;
		wrapper.innerHTML = '<article><span>Post</span></article>';
		document.body.append(wrapper);
		const article = wrapper.querySelector('article')!;
		let opens = false;
		article.addEventListener('click', event => { opens = shouldOpenZalipPost(event, article); });
		article.querySelector('span')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(opens).toBe(true);
	});
});

describe('Zalip delayed post navigation', () => {
	function setup() {
		vi.useFakeTimers();
		const open = vi.fn();
		const navigation = createZalipPostNavigation(open);
		const article = document.createElement('article');
		article.textContent = 'Selectable post';
		document.body.append(article);
		article.addEventListener('click', event => navigation.click(event, article));
		const dispatch = (detail: number) => article.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));
		return { open, navigation, article, dispatch };
	}
	it('opens one single click once', () => {
		const { open, dispatch } = setup();
		dispatch(1);
		expect(open).not.toHaveBeenCalled();
		vi.runAllTimers();
		expect(open).toHaveBeenCalledTimes(1);
	});
	it('cancels navigation on the second click', () => {
		const { open, dispatch } = setup();
		dispatch(1);
		vi.advanceTimersByTime(100);
		dispatch(2);
		vi.runAllTimers();
		expect(open).not.toHaveBeenCalled();
	});
	it('rechecks selection before navigating', () => {
		const { open, article, dispatch } = setup();
		dispatch(1);
		const range = document.createRange();
		range.selectNodeContents(article);
		window.getSelection()?.addRange(range);
		vi.runAllTimers();
		expect(open).not.toHaveBeenCalled();
	});
	it('cancels when the component unmounts or a new gesture begins', () => {
		const { open, navigation, dispatch } = setup();
		dispatch(1);
		navigation.cancel();
		vi.runAllTimers();
		expect(open).not.toHaveBeenCalled();
	});
});
