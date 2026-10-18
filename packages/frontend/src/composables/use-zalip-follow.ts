/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { UserLite } from 'misskey-js/entities.js';
import type { FollowActor } from '@/utility/zalip-follow-relations.js';
import { $i } from '@/i.js';
import { useStream } from '@/stream.js';
import { misskeyApi } from '@/utility/misskey-api.js';
import { createFollowRelationsCache, sameFollowActor } from '@/utility/zalip-follow-relations.js';

function account(): FollowActor | null { return $i ? { id: $i.id, token: $i.token } : null; }

const cache = createFollowRelationsCache({ actor: account, request: (userId, actor, signal) => misskeyApi('users/relation', { userId }, actor.token, signal) });
const visible = new Map<string, number>();
let streamAccount: FollowActor | null = null;
let disconnect: (() => void) | undefined;

function retain(id: string): () => void {
	const actor = account();
	if (!sameFollowActor(streamAccount, actor)) { disconnect?.(); disconnect = undefined; visible.clear(); streamAccount = actor; }
	// No main-channel listener ran while every action was offscreen. Revalidate
	// that account's cached relationships when viewport demand resumes.
	if (visible.size === 0) cache.invalidateAll();
	visible.set(id, (visible.get(id) ?? 0) + 1);
	if (!disconnect && actor) {
		const channel = useStream().useChannel('main');
		const invalidate = (user: UserLite): void => {
			if (!sameFollowActor(actor, account())) return;
			cache.invalidate(user.id);
			if (visible.has(user.id)) void cache.load(user.id);
		};
		channel.on('follow', invalidate);
		channel.on('unfollow', invalidate);
		disconnect = () => channel.dispose();
	}
	return () => {
		if (!sameFollowActor(actor, streamAccount)) return;
		const count = (visible.get(id) ?? 1) - 1;
		if (count > 0) visible.set(id, count); else visible.delete(id);
		if (visible.size === 0) { disconnect?.(); disconnect = undefined; }
	};
}

/** Relations are requested only after the author action actually enters the viewport. */
export function useZalipFollow(target: Readonly<Ref<HTMLElement | null>>, userId: () => string, enabled: () => boolean) {
	const active = ref(true);
	const inView = ref(false);
	const failed = ref(false);
	let observer: IntersectionObserver | undefined;
	let release: (() => void) | undefined;
	let epoch = 0;
	let alive = true;

	function stop(): void { epoch++; observer?.disconnect(); observer = undefined; release?.(); release = undefined; inView.value = false; }

	function valid(): boolean { return alive && active.value && enabled() && !!$i && userId() !== $i.id && window.document.visibilityState === 'visible'; }

	function observe(): void {
		stop(); failed.value = false;
		const element = target.value;
		if (!element || !valid()) return;
		if (typeof IntersectionObserver === 'undefined') { failed.value = true; return; }
		const generation = epoch;
		observer = new IntersectionObserver(entries => {
			if (generation !== epoch || !valid()) return;
			const entry = entries.find(value => value.target === element);
			if (!entry) return;
			const next = entry.isIntersecting && entry.intersectionRatio > 0;
			if (next === inView.value) return;
			inView.value = next;
			release?.(); release = undefined;
			if (inView.value) { release = retain(userId()); void load(); }
		}, { rootMargin: '0px', threshold: 0.01 });
		observer.observe(element);
	}

	async function load(force = false): Promise<void> {
		const id = userId(); const actor = account(); const generation = epoch;
		if (!valid()) return;
		const relation = await cache.load(id, force);
		if (alive && generation === epoch && userId() === id && sameFollowActor(actor, account())) failed.value = relation === null;
	}

	watch([target, userId, () => $i?.id, () => $i?.token, enabled, active], observe, { immediate: true, flush: 'post' });
	window.document.addEventListener('visibilitychange', observe);
	onActivated(() => { active.value = true; });
	onDeactivated(() => { active.value = false; stop(); });
	onBeforeUnmount(() => { alive = false; stop(); window.document.removeEventListener('visibilitychange', observe); });
	return { state: computed(() => cache.peek(userId())), failed, load, lock: () => cache.lock(userId()), account, valid, inView };
}
