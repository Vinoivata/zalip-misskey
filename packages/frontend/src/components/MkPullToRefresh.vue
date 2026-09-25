<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<div ref="rootEl" :class="isPulling ? $style.isPulling : null">
	<!-- 小数が含まれるとレンダリングが高頻度になりすぎパフォーマンスが悪化するためround -->
	<div v-if="isPulling" :class="$style.frame" :style="`--frame-min-height: ${Math.round(pullDistance / (PULL_BRAKE_BASE + (pullDistance / PULL_BRAKE_FACTOR)))}px;`">
		<div :class="$style.frameContent">
			<MkLoading v-if="isRefreshing" :class="$style.loader" :em="true"/>
			<i v-else class="ti ti-arrow-bar-to-down" :class="[$style.icon, { [$style.refresh]: isPulledEnough }]"></i>
			<div :class="$style.text">
				<template v-if="isPulledEnough">{{ i18n.ts.releaseToRefresh }}</template>
				<template v-else-if="isRefreshing">{{ i18n.ts.refreshing }}</template>
				<template v-else>{{ i18n.ts.pullDownToRefresh }}</template>
			</div>
		</div>
	</div>

	<slot></slot>
</div>
</template>

<script lang="ts" setup>
import { onMounted, onUnmounted, ref, useTemplateRef } from 'vue';
import { getScrollContainer } from '@@/js/scroll.js';
import { i18n } from '@/i18n.js';
import { isHorizontalSwipeSwiping } from '@/utility/touch.js';
import { haptic } from '@/utility/haptic.js';
import * as os from '@/os.js';

const SCROLL_STOP = 10;
const MAX_PULL_DISTANCE = Infinity;
const FIRE_THRESHOLD = 200;
const RELEASE_TRANSITION_DURATION = 200;
const PULL_BRAKE_BASE = 1.5;
const PULL_BRAKE_FACTOR = 170;

const isPulling = ref(false);
const isPulledEnough = ref(false);
const isRefreshing = ref(false);
const pullDistance = ref(0);

let startScreenY: number | null = null;
let startScreenX = 0;
let settling = false;
let disposed = false;
let originalOverscrollY = '';
const stopAnimations = new Set<() => void>();

const rootEl = useTemplateRef('rootEl');
let scrollEl: HTMLElement | null = null;

const props = withDefaults(defineProps<{
	refresher: () => Promise<void>;
}>(), {
	refresher: () => Promise.resolve(),
});

const emit = defineEmits<{
	(ev: 'refresh'): void;
}>();

function startPull(event: MouseEvent | TouchEvent): boolean {
	if (isRefreshing.value || settling || startScreenY !== null || disposed) return false;
	if ((scrollEl?.scrollTop ?? 0) > 0) return false;
	if (event.target instanceof HTMLElement) {
		if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return false;
		const nested = getScrollContainer(event.target);
		if (nested && nested !== scrollEl && nested.scrollHeight > nested.clientHeight) return false;
	}
	const point = 'touches' in event ? event.touches[0] : event;
	if (!point) return false;
	startScreenY = point.screenY;
	startScreenX = point.screenX;
	pullDistance.value = 0;
	isPulledEnough.value = false;
	return true;
}

function moveStartByMouse(event: MouseEvent) {
	if (event.button !== 1) return;
	if (!startPull(event)) return;
	event.preventDefault(); // 中クリックによるスクロール、テキスト選択などを防ぐ
	window.addEventListener('mousemove', moving, { passive: false });
	window.addEventListener('mouseup', onPullEnd, { passive: true });
}

function moveStartByTouch(event: TouchEvent) {
	if (event.touches.length !== 1 || !startPull(event)) return;
	// Only consume a downward pull at the top, leaving horizontal rails and normal scrolling native.
	window.addEventListener('touchmove', moving, { passive: false });
	window.addEventListener('touchend', onPullEnd, { passive: true });
	window.addEventListener('touchcancel', cancelPull, { passive: true });
}

function detachGesture() {
	window.removeEventListener('mousemove', moving);
	window.removeEventListener('mouseup', onPullEnd);
	window.removeEventListener('touchmove', moving);
	window.removeEventListener('touchend', onPullEnd);
	window.removeEventListener('touchcancel', cancelPull);
}

function onPullEnd() {
	detachGesture();
	void onPullRelease();
}

function cancelPull() {
	isPulledEnough.value = false;
	onPullEnd();
}

function moveBySystem(to: number): Promise<void> {
	return new Promise(r => {
		const startHeight = pullDistance.value;
		const overHeight = pullDistance.value - to;
		if (overHeight < 1) {
			r();
			return;
		}
		const startTime = Date.now();
		const stop = () => {
			window.clearInterval(intervalId);
			stopAnimations.delete(stop);
			r();
		};
		let intervalId = window.setInterval(() => {
			const time = Date.now() - startTime;
			if (time > RELEASE_TRANSITION_DURATION) {
				pullDistance.value = to;
				stop();
				return;
			}
			const nextHeight = startHeight - (overHeight / RELEASE_TRANSITION_DURATION) * time;
			if (pullDistance.value < nextHeight) return;
			pullDistance.value = nextHeight;
		}, 16);
		stopAnimations.add(stop);
	});
}

async function fixOverContent() {
	if (pullDistance.value > FIRE_THRESHOLD) {
		await moveBySystem(FIRE_THRESHOLD);
	}
}

async function closeContent() {
	if (pullDistance.value > 0) {
		await moveBySystem(0);
	}
}

async function onPullRelease() {
	if (startScreenY === null) return;
	startScreenY = null;
	settling = true;
	const shouldRefresh = isPulledEnough.value;
	isPulledEnough.value = false;
	try {
		if (shouldRefresh) {
			isRefreshing.value = true;
			await fixOverContent();
			if (disposed) return;
			emit('refresh');
			await props.refresher();
		}
	} catch {
		if (!disposed) void os.alert({ type: 'error', text: i18n.ts.somethingHappened });
	} finally {
		if (!disposed) await closeContent();
		isPulling.value = false;
		isRefreshing.value = false;
		settling = false;
	}
}

function moving(event: MouseEvent | TouchEvent) {
	if (startScreenY === null) return;
	if ('touches' in event && event.touches.length !== 1) {
		cancelPull();
		return;
	}
	if ((scrollEl?.scrollTop ?? 0) > SCROLL_STOP + pullDistance.value || isHorizontalSwipeSwiping.value) {
		cancelPull();
		return;
	}

	const point = 'touches' in event ? event.touches[0] : event;
	const moveHeight = point.screenY - startScreenY;
	const moveWidth = Math.abs(point.screenX - startScreenX);
	if (!isPulling.value && (moveWidth > SCROLL_STOP && moveWidth > Math.abs(moveHeight) || moveHeight < -SCROLL_STOP)) {
		cancelPull();
		return;
	}
	if (!isPulling.value && moveHeight < SCROLL_STOP) return;
	if (event.cancelable) event.preventDefault();
	isPulling.value = true;
	pullDistance.value = Math.min(Math.max(moveHeight, 0), MAX_PULL_DISTANCE);
	const wasEnough = isPulledEnough.value;
	isPulledEnough.value = pullDistance.value >= FIRE_THRESHOLD;
	if (isPulledEnough.value && !wasEnough) haptic();
}

onMounted(() => {
	if (rootEl.value == null) return;
	scrollEl = getScrollContainer(rootEl.value) ?? window.document.documentElement;
	originalOverscrollY = scrollEl.style.overscrollBehaviorY;
	scrollEl.style.overscrollBehaviorY = 'contain';
	rootEl.value.addEventListener('mousedown', moveStartByMouse, { passive: false }); // preventDefaultするため
	rootEl.value.addEventListener('touchstart', moveStartByTouch, { passive: true });
});

onUnmounted(() => {
	disposed = true;
	detachGesture();
	stopAnimations.forEach(stop => stop());
	if (scrollEl) scrollEl.style.overscrollBehaviorY = originalOverscrollY;
	if (rootEl.value) rootEl.value.removeEventListener('mousedown', moveStartByMouse);
	if (rootEl.value) rootEl.value.removeEventListener('touchstart', moveStartByTouch);
});
</script>

<style lang="scss" module>
.isPulling {
	will-change: contents;
}

.frame {
	position: relative;
	overflow: clip;

	width: 100%;
	min-height: var(--frame-min-height, 0px);

	mask-image: linear-gradient(90deg, #000 0%, #000 80%, transparent);
	-webkit-mask-image: -webkit-linear-gradient(90deg, #000 0%, #000 80%, transparent);

	pointer-events: none;
}

.frameContent {
	position: absolute;
	bottom: 0;
	width: 100%;
	margin: 5px 0;
	display: flex;
	flex-direction: column;
	align-items: center;

	> .icon, > .loader {
		margin: 6px 0;
	}

	> .icon {
		transition: transform .25s;

		&.refresh {
			transform: rotate(180deg);
		}
	}

	> .text {
		margin: 5px 0;
		font-size: 90%;
	}
}
</style>
