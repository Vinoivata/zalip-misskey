<!--
SPDX-FileCopyrightText: syuilo and misskey-project
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<!-- durationは子Itemコンポーネントがフェードイン/アウトするdurationと合わせる -->
<Transition
	:enterActiveClass="animationEnabled ? $style.transition_root_enterActive : ''"
	:leaveActiveClass="animationEnabled ? $style.transition_root_leaveActive : ''"
	:enterFromClass="animationEnabled ? $style.transition_root_enterFrom : ''"
	:leaveToClass="animationEnabled ? $style.transition_root_leaveTo : ''"
	:duration="{ enter: animationEnabled ? openAnimDuration : 0, leave: animationEnabled ? closeAnimDuration : 0 }"
	appear
	@afterLeave="onAfterLeave"
>
	<!-- v-ifを使うとfalseになったとき(transitionが行われている間)子コンポーネントの更新が停止するのか子コンポーネントがアニメーションされなくなる -->
	<div v-show="showing" ref="rootEl" role="dialog" aria-modal="true" :aria-label="i18n.ts.images" tabindex="-1" :class="$style.root" :style="{ zIndex }">
		<div :class="[$style.bg]" class="_modalBg"></div>
		<div ref="mainEl" :class="$style.main">
			<div
				ref="itemsEl"
				:class="[$style.items, { [$style.itemsTransition]: enableSlideTransition }]"
				:style="{ translate: `${contentsOffset}px 0` }"
				@transitionend.self="onSlideTransitionFinished"
				@transitioncancel.self="onSlideTransitionFinished"
			>
				<div v-for="(content, i) in contents" :key="content.url" ref="itemEl" :class="$style.item" :inert="i !== currentIndex || !showing" :aria-hidden="i !== currentIndex || !showing">
					<XItem
						:ref="(comp) => { items.set(i, comp as InstanceType<typeof XItem>); }"
						:content="content"
						:initiallyOpened="i === initialIndex"
						:activated="activatedIndexes.has(i)"
						:animation="animationEnabled"
						@close="onItemClose"
						@horizontalSwipe="onHorizontalSwipe"
						@prev="onPrev"
						@next="onNext"
						@cancelHorizontalSwipe="onCancelHorizontalSwipe"
					/>
				</div>
			</div>

			<button v-if="!isTouchUsing && currentIndex > 0" type="button" class="_button" :class="[$style.prevButton]" :aria-label="i18n.ts.zalip._importer.previous" @click="onPrev"><div :class="$style.buttonIcon"><i class="ti ti-arrow-left" aria-hidden="true"></i></div></button>
			<button v-if="!isTouchUsing && currentIndex < contents.length - 1" type="button" class="_button" :class="[$style.nextButton]" :aria-label="i18n.ts.next" @click="onNext"><div :class="$style.buttonIcon"><i class="ti ti-arrow-right" aria-hidden="true"></i></div></button>
		</div>
	</div>
</Transition>
</template>

<script lang="ts" setup>
import { computed, ref, watch, nextTick, onBeforeUnmount, onMounted, useTemplateRef } from 'vue';
import XItem from './MkLightbox.item.vue';
import type { Content } from './MkLightbox.item.vue';
import type { Keymap } from '@/utility/hotkey.js';
import { makeHotkey } from '@/utility/hotkey.js';
import * as os from '@/os.js';
import { prefer } from '@/preferences.js';
import { isTouchUsing } from '@/utility/touch.js';
import { focusTrap } from '@/utility/focus-trap.js';
import { i18n } from '@/i18n.js';

const props = withDefaults(defineProps<{
	defaultIndex?: number;
	contents: Content[];
}>(), {
	defaultIndex: 0,
});

const emit = defineEmits<{
	(ev: 'closed'): void;
}>();

const rootEl = useTemplateRef('rootEl');
const activatedIndexes = ref(new Set<number>());
const items = new Map<number, InstanceType<typeof XItem> | null>();
const initialIndex = Math.max(0, Math.min(props.contents.length - 1, Number.isFinite(props.defaultIndex) ? Math.trunc(props.defaultIndex) : 0));
const currentIndex = ref(initialIndex);
const opener = window.document.activeElement instanceof HTMLElement ? window.document.activeElement : null;
const sourceVisibility = new Map(props.contents.flatMap(content => content.sourceElement ? [[content.sourceElement, content.sourceElement.style.visibility] as const] : []));
const previousLocation = window.location.href;
const historyLocation = new URL('#pswp', previousLocation).href;
const previousHistoryState: unknown = window.history.state;
const historyEntryId = crypto.randomUUID();
let historyBackRequested = false;
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = ref(reducedMotionQuery.matches);
const animationEnabled = computed(() => !!prefer.s.animation && !reducedMotion.value);

watch(currentIndex, (newIndex, oldIndex) => {
	// Keep only visited neighbours alive. Never request an unvisited original in advance.
	activatedIndexes.value = new Set([...activatedIndexes.value].filter(index => Math.abs(index - newIndex) <= 1).concat(newIndex));

	nextTick(() => {
		if (oldIndex != null && items.has(oldIndex)) {
			items.get(oldIndex)?.onDeactive();
		}
		if (items.has(newIndex)) {
			items.get(newIndex)?.onActive();
		}
	});
}, { immediate: true });

watch(currentIndex, (newIndex) => {
	for (let i = 0; i < props.contents.length; i++) {
		const content = props.contents[i];
		if (content.sourceElement != null) {
			content.sourceElement.style.visibility = i === newIndex ? 'hidden' : sourceVisibility.get(content.sourceElement) ?? '';
		}
	}
}, { immediate: false });

const openAnimDuration = 200;
const closeAnimDuration = 200;
const slideAnimDuration = 300;
const zIndex = os.claimZIndex('high');
const showing = ref(true);
const screenWidth = ref(window.innerWidth);
const contentsOffset = ref(currentIndex.value * -window.innerWidth);
const enableSlideTransition = ref(false);
let currentScrollLeft = contentsOffset.value;

function onResize() {
	screenWidth.value = window.innerWidth;
	scrollToCurrentIndex();
}

function onHorizontalSwipe(offset: number) {
	if (currentIndex.value === 0 && offset > 0) { // これ以上戻れない
		contentsOffset.value = currentScrollLeft + (offset / 3);
	} else if (currentIndex.value === props.contents.length - 1 && offset < 0) { // これ以上進めない
		contentsOffset.value = currentScrollLeft + (offset / 3);
	} else {
		contentsOffset.value = currentScrollLeft + offset;
	}
}

function scrollToCurrentIndex() {
	const targetOffset = currentIndex.value * -screenWidth.value;
	currentScrollLeft = targetOffset;

	if (!animationEnabled.value || contentsOffset.value === targetOffset) {
		enableSlideTransition.value = false;
		contentsOffset.value = targetOffset;
		return;
	}

	enableSlideTransition.value = true;
	contentsOffset.value = targetOffset;
}

/** ギャラリーそのものを閉じるための内部処理（閉じる処理を書く場合は `close` か、item内では `closeThis` を使う） */
function closeGallery() {
	if (!showing.value) return;
	showing.value = false;
	stopListening();
	releaseFocus();
	if (ownsHistoryEntry()) {
		historyBackRequested = true;
		window.history.back();
	}
}

function close() {
	if (!showing.value) return;
	const item = items.get(currentIndex.value);
	if (item != null) {
		item.closeThis();
	} else {
		closeGallery();
	}
}

function onSlideTransitionFinished(ev: TransitionEvent) {
	if (ev.propertyName !== 'translate') return;
	enableSlideTransition.value = false;
}

function onCancelHorizontalSwipe() {
	scrollToCurrentIndex();
}

function onNext() {
	if (!showing.value) return;
	if (currentIndex.value < props.contents.length - 1) {
		currentIndex.value++;
	}
	scrollToCurrentIndex();
}

function onPrev() {
	if (!showing.value) return;
	if (currentIndex.value > 0) {
		currentIndex.value--;
	}
	scrollToCurrentIndex();
}

function onItemClose() {
	closeGallery();
}

function onAfterLeave() {
	cleanup();
	emit('closed');
}

function onPopState() {
	if (showing.value) {
		close();
	}
}

let releaseFocusTrap: (() => void) | null = null;
let focusRestored = false;
let cleanedUp = false;

function ownsHistoryEntry() {
	return window.location.href === historyLocation && window.history.state?.misskeyLightbox === historyEntryId;
}

function releaseFocus() {
	releaseFocusTrap?.();
	releaseFocusTrap = null;
}

function stopListening() {
	window.removeEventListener('resize', onResize);
	window.removeEventListener('popstate', onPopState);
	window.document.removeEventListener('keydown', onKeydown);
	reducedMotionQuery.removeEventListener('change', onReducedMotionChange);
}

function cleanup() {
	if (cleanedUp) return;
	cleanedUp = true;
	stopListening();
	releaseFocus();
	for (const [element, visibility] of sourceVisibility) element.style.visibility = visibility;
	// Disposing a stale gallery must not asynchronously navigate a newer gallery or route back.
	if (!historyBackRequested && ownsHistoryEntry()) window.history.replaceState(previousHistoryState, '', previousLocation);
	if (!focusRestored && opener?.isConnected && !opener.closest('[inert]')) {
		opener.focus({ preventScroll: true });
		focusRestored = true;
	}
}

function onReducedMotionChange(event: MediaQueryListEvent) {
	reducedMotion.value = event.matches;
}

watch(animationEnabled, enabled => {
	if (!enabled) enableSlideTransition.value = false;
});

onMounted(() => {
	if (rootEl.value != null) {
		const { release } = focusTrap(rootEl.value);
		releaseFocusTrap = release;
		nextTick(() => {
			if (showing.value && rootEl.value?.isConnected && !rootEl.value.inert) rootEl.value.focus({ preventScroll: true });
		});
	}

	window.history.pushState({ misskeyLightbox: historyEntryId }, '', '#pswp');
	window.addEventListener('resize', onResize, { passive: true });
	window.addEventListener('popstate', onPopState);
	window.document.addEventListener('keydown', onKeydown);
	reducedMotionQuery.addEventListener('change', onReducedMotionChange);
});

const keymap = {
	'esc': () => close(),
	'arrowleft': {
		allowRepeat: true,
		callback: () => onPrev(),
	},
	'arrowright': {
		allowRepeat: true,
		callback: () => onNext(),
	},
} as const satisfies Keymap;

const handleHotkey = makeHotkey(keymap);

function onKeydown(event: KeyboardEvent) {
	const root = rootEl.value;
	if (!showing.value || !root || root.inert || event.defaultPrevented) return;
	if (event.key === 'Tab') {
		const controls = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]')).filter(element => !element.closest('[inert]'));
		const first = controls[0];
		const last = controls.at(-1);
		if (event.shiftKey && (window.document.activeElement === first || window.document.activeElement === root)) {
			event.preventDefault();
			(last ?? root).focus();
		} else if (!event.shiftKey && (window.document.activeElement === last || !first)) {
			event.preventDefault();
			(first ?? root).focus();
		}
		return;
	}
	handleHotkey(event);
}

onBeforeUnmount(() => {
	cleanup();
	items.clear();
});

defineExpose({
	close,
});
</script>

<style lang="scss" module>
.transition_root_enterActive,
.transition_root_leaveActive {
	> .bg {
		transition: opacity v-bind("closeAnimDuration + 'ms'"); // 子Itemコンポーネントがフェードイン/アウトするdurationと合わせる
	}
}
.transition_root_enterFrom,
.transition_root_leaveTo {
	pointer-events: none;
	> .bg {
		opacity: 0;
	}
}

.root {
	position: fixed;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
}

.bg {
}

.main {
	position: absolute;
	width: 100%;
	height: 100%;
}

.items {
	position: absolute;
	display: flex;
	width: calc(v-bind("screenWidth + 'px'") * v-bind("contents.length"));
	height: 100dvh;
	overflow: clip;
	contain: strict;
}

.itemsTransition {
	pointer-events: none;
	transition: translate v-bind("slideAnimDuration + 'ms'") cubic-bezier(0.45, 0, 0.55, 1);
}

.item {
	width: 100dvw;
	height: 100dvh;
	overflow: clip;
	contain: strict;
	flex-shrink: 0;
}

.prevButton,
.nextButton {
	position: absolute;
	top: 0;
	width: 70px;
	height: 100%;
	display: grid;
	place-items: center;
}
.prevButton {
	left: 0;
}
.nextButton {
	right: 0;
}

.buttonIcon {
	width: 45px;
	height: 45px;
	display: grid;
	place-items: center;
	background-color: rgba(0, 0, 0, 0.3);
	border-radius: 100%;
	color: #fff;
}
</style>
