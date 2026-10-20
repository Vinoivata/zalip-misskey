<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<aside v-if="enabled && desktop && !chatPage" :class="$style.root" :aria-label="i18n.ts.zalip._chatUi.miniChats">
	<div v-if="minimized.length" :class="$style.minimized">
		<div v-for="item in minimized" :key="item.key" :class="$style.minimizedItem">
			<button type="button" class="_button" :class="$style.restore" :aria-label="`${i18n.ts.zalip._chatUi.restore}: ${item.title || i18n.ts.zalip.messages}`" @click="restore(item)"><i class="ti ti-message-circle" aria-hidden="true"></i><span>{{ item.title || i18n.ts.zalip.messages }}</span></button>
			<button type="button" class="_button" :class="$style.closeSmall" :aria-label="i18n.ts.zalip._chatUi.closeConversation" @click="dock.close(item.key)"><i class="ti ti-x" aria-hidden="true"></i></button>
		</div>
	</div>
	<div :class="$style.panels">
		<section v-if="dock.listOpen.value" :class="[$style.panel, $style.list]" :aria-label="i18n.ts.zalip._chatUi.conversations">
			<header :class="$style.header"><strong>{{ i18n.ts.zalip._chatUi.conversations }}</strong><button type="button" class="_button" :class="$style.headerAction" :aria-label="i18n.ts.zalip._chatUi.openFullPage" @click="openMessages"><i class="ti ti-arrows-maximize" aria-hidden="true"></i></button><button type="button" class="_button" :class="$style.headerAction" :aria-label="i18n.ts.close" @click="dock.listOpen.value = false"><i class="ti ti-x" aria-hidden="true"></i></button></header>
			<div :class="$style.listBody"><ChatSidebar compact @select="restore"/></div>
		</section>
		<section v-for="item in expanded" :key="item.key" :class="$style.panel" :aria-label="item.title || i18n.ts.zalip.messages">
			<header :class="$style.header"><MkA v-if="metadata[item.key]?.user" :to="userPage(metadata[item.key].user!)" :class="$style.identity" :title="i18n.ts.zalip._chatUi.openProfile"><MkAvatar :user="metadata[item.key].user!" :link="false" :class="$style.avatar"/><span :class="$style.identityText"><strong>{{ item.title || i18n.ts.zalip.messages }}</strong><span>@{{ metadata[item.key].user!.username }}</span></span></MkA><span v-else :class="$style.identity"><i class="ti ti-users-group" :class="$style.avatar" aria-hidden="true"></i><strong>{{ item.title || i18n.ts.zalip.messages }}</strong></span><button type="button" class="_button" :class="$style.headerAction" :aria-label="i18n.ts.zalip._chatUi.minimize" @click="dock.minimize(item.key)"><i class="ti ti-minus" aria-hidden="true"></i></button><button type="button" class="_button" :class="$style.headerAction" :aria-label="i18n.ts.zalip._chatUi.openFullPage" @click="openFull(item)"><i class="ti ti-arrows-maximize" aria-hidden="true"></i></button><button type="button" class="_button" :class="$style.headerAction" :aria-label="i18n.ts.zalip._chatUi.closeConversation" @click="dock.close(item.key)"><i class="ti ti-x" aria-hidden="true"></i></button></header>
			<div :class="$style.conversation"><ChatConversation :userId="item.userId" :roomId="item.roomId" :active="visible && !modalOpen" compact @loaded="loaded(item.key, $event)" @close="dock.close(item.key)"/></div>
		</section>
	</div>
	<button type="button" class="_button" :class="$style.launcher" :aria-label="i18n.ts.zalip._chatUi.openMessages" :aria-expanded="dock.listOpen.value" @click="dock.listOpen.value = !dock.listOpen.value"><i class="ti ti-messages" aria-hidden="true"></i><span v-if="$i?.hasUnreadChatMessages" :class="$style.unread" :aria-label="i18n.ts.zalip._chatUi.unread"></span></button>
</aside>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue';
import type { ZalipChatTarget } from '@/utility/zalip-chat-dock.js';
import type { ChatConversationMetadata } from '@/utility/zalip-chat-types.js';
import { $i } from '@/i.js';
import { i18n } from '@/i18n.js';
import { mainRouter } from '@/router.js';
import { popups } from '@/os.js';
import { deviceKind } from '@/utility/device-kind.js';
import { zalipChatDock as dock, zalipChatTargetPath } from '@/utility/zalip-chat-dock.js';
import { hasBlockingChatPopup } from '@/utility/zalip-chat-visibility.js';
import { userPage } from '@/filters/user.js';

const ChatConversation = defineAsyncComponent(() => import('@/components/MkZalipChatConversation.vue'));
const ChatSidebar = defineAsyncComponent(() => import('@/components/MkZalipChatSidebar.vue'));
const width = ref(window.innerWidth);
const visible = ref(window.document.visibilityState === 'visible');
const enabled = computed(() => !!$i && $i.policies.chatAvailability !== 'unavailable');
const desktop = computed(() => deviceKind === 'desktop' && width.value > 1099);
const chatPage = computed(() => /^\/chat(?:\/|$)/u.test(mainRouter.currentRoute.value.path));
const modalOpen = computed(() => hasBlockingChatPopup(popups.value));
const metadata = ref<Record<string, ChatConversationMetadata>>({});
const expanded = computed(() => dock.windows.value.filter(item => !item.collapsed));
const minimized = computed(() => dock.windows.value.filter(item => item.collapsed));

function restore(target: ZalipChatTarget): void { dock.open(target, width.value >= 1600 ? 2 : 1); }

function openMessages(): void { dock.listOpen.value = false; mainRouter.push('/chat'); }

function openFull(target: ZalipChatTarget): void { mainRouter.pushByPath(zalipChatTargetPath(target)); }

function loaded(key: string, value: ChatConversationMetadata): void { if (!dock.windows.value.some(item => item.key === key)) return; metadata.value = { ...metadata.value, [key]: value }; dock.setTitle(key, value.title); }

function visibilityChanged(): void { visible.value = window.document.visibilityState === 'visible'; }

function resized(): void {
	width.value = window.innerWidth;
	if (width.value < 1600) {
		for (const item of expanded.value.slice(0, -1)) dock.minimize(item.key);
	}
}

watch(() => $i?.id ?? null, id => dock.setAccount(id), { immediate: true });
watch(enabled, value => { dock.setAccount(value ? $i?.id ?? null : null); });
watch(() => dock.ownerId.value, () => { metadata.value = {}; });
watch(() => dock.windows.value.map(item => item.key).join(','), () => { const keys = new Set(dock.windows.value.map(item => item.key)); metadata.value = Object.fromEntries(Object.entries(metadata.value).filter(([key]) => keys.has(key))); });
window.addEventListener('resize', resized, { passive: true });
window.document.addEventListener('visibilitychange', visibilityChanged);
onBeforeUnmount(() => {
	window.removeEventListener('resize', resized);
	window.document.removeEventListener('visibilitychange', visibilityChanged);
});
</script>

<style lang="scss" module>
.root { position: fixed; right: 16px; bottom: 16px; z-index: 1100; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; max-width: calc(100vw - 272px); pointer-events: none; }
.panels { display: flex; align-items: flex-end; gap: 12px; max-width: 100%; }
.panel { display: flex; flex-direction: column; width: 360px; height: min(620px, calc(100dvh - 150px)); overflow: hidden; background: var(--MI_THEME-panel); color: var(--MI_THEME-fg); border: 1px solid var(--MI_THEME-divider); border-radius: var(--MI-radius); box-shadow: 0 12px 40px var(--MI_THEME-shadow); pointer-events: auto; }
.list { width: 330px; }
.header { display: flex; align-items: center; min-height: 52px; padding: 4px 6px 4px 16px; border-bottom: 1px solid var(--MI_THEME-divider); strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; } }
.headerAction { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 8px; color: var(--MI_THEME-fgTransparentWeak); &:hover { background: var(--MI_THEME-buttonHoverBg); color: var(--MI_THEME-fg); } }
.identity { display: flex; align-items: center; flex: 1; min-width: 0; min-height: 44px; gap: 8px; }
.identityText { display: grid; min-width: 0; gap: 2px; > strong, > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } > span { font-size: 11px; color: var(--MI_THEME-fgTransparentWeak); } }
.avatar { display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 30px; font-size: 22px; }
.conversation, .listBody { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.conversation { display: flex; > :global(*) { flex: 1; min-width: 0; } }
.launcher { position: relative; display: grid; place-items: center; width: 52px; height: 52px; border: 1px solid var(--MI_THEME-divider); border-radius: 50%; background: var(--MI_THEME-accent); color: var(--MI_THEME-fgOnAccent); font-size: 25px; pointer-events: auto; box-shadow: 0 6px 20px var(--MI_THEME-shadow); }
.unread { position: absolute; top: 1px; right: 1px; width: 10px; height: 10px; border: 2px solid var(--MI_THEME-panel); border-radius: 50%; background: var(--MI_THEME-error); }
.minimized { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; max-width: 100%; }
.minimizedItem { display: flex; align-items: center; max-width: 190px; border: 1px solid var(--MI_THEME-divider); border-radius: 999px; background: var(--MI_THEME-panel); pointer-events: auto; }
.restore { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 44px; padding: 6px 8px 6px 12px; font-size: 12px; span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.closeSmall { flex: 0 0 44px; min-height: 44px; border-radius: 50%; color: var(--MI_THEME-fgTransparentWeak); }
.root button:focus-visible { outline: 2px solid var(--MI_THEME-accent); outline-offset: 3px; }
</style>
