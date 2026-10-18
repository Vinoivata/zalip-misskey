/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { onActivated, onBeforeUnmount, onDeactivated, readonly, ref, watch } from 'vue';
import * as Misskey from 'misskey-js';
import type { Ref } from 'vue';
import { $i } from '@/i.js';
import { misskeyApiZalip } from '@/utility/misskey-api.js';

type ViewNote = Misskey.entities.Note & { zalipViewCount?: number };

function validCount(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Count only an authenticated reader's actually visible, revealed article. */
export function useZalipNoteViews(target: Readonly<Ref<HTMLElement | null>>, note: () => ViewNote, enabled: () => boolean): Readonly<Ref<number | undefined>> {
	const count = ref<number>();
	const active = ref(true);
	const attempted = new Set<string>();
	let observer: IntersectionObserver | undefined;
	let resizeObserver: ResizeObserver | undefined;
	let timer: number | undefined;
	let generation = 0;
	let alive = true;
	let context = '';

	function clearTimer(): void {
		if (timer !== undefined) window.clearTimeout(timer);
		timer = undefined;
	}

	function stop(): void {
		generation++;
		clearTimer();
		observer?.disconnect();
		observer = undefined;
		resizeObserver?.disconnect();
		resizeObserver = undefined;
	}

	function eligible(): boolean {
		const current = note();
		return !!$i?.id && current.userId !== $i.id && !current.isHidden && !current.deletedAt && !Misskey.note.isPureRenote(current) && active.value && enabled() && window.document.visibilityState === 'visible';
	}

	function observe(): void {
		stop();
		const current = note();
		const noteId = current.id;
		const account = $i?.id ?? null;
		const key = JSON.stringify([account, noteId]);
		if (context !== key) {
			context = key;
			count.value = validCount(current.zalipViewCount);
			attempted.clear();
		}
		const element = target.value;
		if (!alive || !element || !eligible() || attempted.has(key) || typeof IntersectionObserver === 'undefined') return;
		const epoch = generation;
		const height = element.getBoundingClientRect().height;
		const threshold = height > 0 ? Math.min(1, 120 / height) : 1;
		let visible = false;
		observer = new IntersectionObserver(entries => {
			if (epoch !== generation || !alive) return;
			const entry = entries.find(value => value.target === element);
			if (!entry) return;
			const targetHeight = entry.boundingClientRect.height;
			visible = entry.isIntersecting && targetHeight > 0 && entry.intersectionRect.width > 0 && entry.intersectionRect.height >= Math.min(120, targetHeight);
			if (!visible || !eligible()) { clearTimer(); return; }
			if (timer !== undefined || attempted.has(key)) return;
			timer = window.setTimeout(() => {
				timer = undefined;
				if (epoch !== generation || !visible || !alive || !eligible() || target.value !== element || note().id !== noteId || ($i?.id ?? null) !== account) return;
				attempted.add(key);
				void misskeyApiZalip<{ counted: boolean; viewCount: number }>('zalip/notes/views/record', { noteId }).then(result => {
					if (!alive || note().id !== noteId || ($i?.id ?? null) !== account || target.value !== element) return;
					const next = validCount(result.viewCount);
					if (next !== undefined) count.value = Math.max(count.value ?? 0, next);
				}).catch(() => { /* Best effort: do not create an automatic retry loop. */ });
			}, 1000);
		}, { rootMargin: '0px', threshold });
		observer.observe(element);
		if (typeof ResizeObserver !== 'undefined') {
			resizeObserver = new ResizeObserver(() => {
				if (epoch === generation && alive && element.getBoundingClientRect().height !== height) observe();
			});
			resizeObserver.observe(element);
		}
	}

	watch([target, () => note().id, () => $i?.id, active, enabled], observe, { immediate: true, flush: 'post' });
	watch(() => note().zalipViewCount, value => {
		const next = validCount(value);
		if (next !== undefined) count.value = Math.max(count.value ?? 0, next);
	});
	window.document.addEventListener('visibilitychange', observe);
	onActivated(() => { active.value = true; });
	onDeactivated(() => { active.value = false; stop(); });
	onBeforeUnmount(() => { alive = false; stop(); window.document.removeEventListener('visibilitychange', observe); });
	return readonly(count);
}
