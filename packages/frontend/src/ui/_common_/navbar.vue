<!--
SPDX-FileCopyrightText: Zalip contributors
SPDX-License-Identifier: AGPL-3.0-only
-->

<template>
<aside :class="$style.root">
	<MkA to="/" :class="$style.brand" :aria-label="i18n.ts.zalip.brand">zalip</MkA>
	<nav :class="$style.menu" :aria-label="i18n.ts.menu">
		<MkA to="/timeline" :class="$style.item" :activeClass="$style.active"><MkZalipIcon name="home"/><span>{{ navbarItemDef.feed.title }}</span></MkA>
		<MkA to="/" exact :class="$style.item" :activeClass="$style.active"><MkZalipIcon name="reels"/><span>{{ navbarItemDef.zalip.title }}</span></MkA>
		<MkA v-if="$i && $i.policies.chatAvailability !== 'unavailable'" to="/chat" :class="$style.item" :activeClass="$style.active"><MkZalipIcon name="messages"/><span>{{ i18n.ts.zalip.messages }}</span><span v-if="$i.hasUnreadChatMessages" :class="$style.indicator"></span></MkA>
		<MkA v-if="$i" to="/my/notifications" :class="$style.item" :activeClass="$style.active"><MkZalipIcon name="heart"/><span>{{ i18n.ts.notifications }}</span><span v-if="$i.hasUnreadNotification" :class="$style.indicator"></span></MkA>
		<MkA to="/catalog" :class="$style.item" :activeClass="$style.active"><MkZalipIcon name="movie"/><span>{{ navbarItemDef.catalogue.title }}</span></MkA>
		<MkA to="/library" :class="$style.item" :activeClass="$style.active"><MkZalipIcon name="bookmark"/><span>{{ navbarItemDef.library.title }}</span></MkA>
		<MkA v-if="$i" to="/updates" :class="$style.item" :activeClass="$style.active"><MkZalipIcon name="users"/><span>{{ navbarItemDef.updates.title }}</span></MkA>
		<button type="button" class="_button" :class="$style.post" data-testid="open-post-form" @click="openZalipCreateMenu"><MkZalipIcon name="plus"/><span>{{ i18n.ts.create }}</span></button>
		<MkA v-if="$i?.isAdmin" to="/zalip/editor" :class="$style.admin"><MkZalipIcon name="movie"/><span>{{ i18n.ts.zalip.addContent }}</span></MkA>
	</nav>
	<div :class="$style.bottom">
		<MkA v-if="$i?.isAdmin || $i?.isModerator" to="/admin" :class="$style.secondary"><MkZalipIcon name="settings"/><span>{{ i18n.ts.controlPanel }}</span></MkA>
		<MkA to="/settings" :class="$style.secondary"><MkZalipIcon name="settings"/><span>{{ i18n.ts.settings }}</span></MkA>
		<button type="button" class="_button" :class="$style.secondary" @click="openAppearanceMenu"><MkZalipIcon :name="store.r.darkMode.value ? 'sun' : 'moon'"/><span>{{ i18n.ts.zalip.appearanceTitle }}</span></button>
		<button v-if="showWidgetButton" type="button" class="_button" :class="$style.secondary" @click="emit('widgetButtonClick')"><MkZalipIcon name="settings"/><span>{{ i18n.ts.widgets }}</span></button>
		<button v-if="$i" type="button" class="_button" :class="$style.account" @click="openAccountMenu">
			<MkAvatar :user="$i" :class="$style.avatar"/><span><strong>{{ $i.name || $i.username }}</strong><small>@{{ $i.username }}</small></span>
		</button>
		<button v-else type="button" class="_button" :class="$style.post" @click="pleaseLogin()">{{ i18n.ts.login }}</button>
	</div>
</aside>
</template>

<script lang="ts" setup>
import MkZalipIcon from '@/components/MkZalipIcon.vue';
import { navbarItemDef } from '@/navbar.js';
import * as os from '@/os.js';
import { store } from '@/store.js';
import { i18n } from '@/i18n.js';
import { getAccountMenu } from '@/accounts.js';
import { $i } from '@/i.js';
import { getZalipAppearanceMenu } from '@/utility/zalip-theme.js';
import { openZalipCreateMenu } from '@/utility/zalip-create.js';
import { pleaseLogin } from '@/utility/please-login.js';

defineProps<{ showWidgetButton?: boolean; asDrawer?: boolean }>();
const emit = defineEmits<{ (ev: 'widgetButtonClick'): void }>();

async function openAccountMenu(event: PointerEvent): Promise<void> {
	void os.popupMenu(await getAccountMenu({ withExtraOperation: true }), event.currentTarget ?? event.target);
}

function openAppearanceMenu(event: PointerEvent): void {
	void os.popupMenu(getZalipAppearanceMenu(), event.currentTarget ?? event.target, { align: 'right', width: 280 });
}
</script>

<style lang="scss" module>
.root { display: flex; flex-direction: column; flex: 0 0 240px; width: 240px; height: 100%; padding: 20px 28px 20px 16px; box-sizing: border-box; overflow-y: auto; scrollbar-width: none; background: var(--zalip-social-bg); color: var(--zalip-social-muted); font-family: Inter, Arial, sans-serif; }
.brand { align-self: flex-start; padding: 0 12px 24px; color: var(--zalip-social-fg); text-decoration: none; font-size: 38px; font-weight: 800; letter-spacing: -3px; line-height: 1; }
.menu { display: flex; flex-direction: column; gap: 4px; }
.item, .post, .secondary, .admin { display: flex; align-items: center; gap: 18px; min-height: 54px; padding: 0 14px; border-radius: 30px; text-decoration: none; color: inherit; text-align: left; box-sizing: border-box; }
.item { position: relative; align-self: flex-start; max-width: 100%; gap: 14px; font-size: 17px; font-weight: 600; > svg { width: 27px; height: 27px; flex-shrink: 0; } > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.item:hover, .secondary:hover, .account:hover { background: var(--zalip-social-hover); }
.active { background: var(--zalip-accent-soft); color: var(--zalip-social-fg); box-shadow: inset 0 0 0 1px var(--zalip-accent-border); > svg { color: var(--MI_THEME-accent); } }
.post { justify-content: center; min-height: 48px; margin-top: 18px; border: 1px solid var(--zalip-social-fg); font-size: 19px; font-weight: 600; }
.admin { min-height: 42px; padding: 0 10px; gap: 10px; font-size: 14px; color: var(--MI_THEME-accent); }
.bottom { margin-top: auto; padding-top: 24px; }
.secondary { gap: 18px; min-height: 44px; font-size: 15px; }
.account { display: flex; align-items: center; gap: 12px; width: 100%; margin-top: 14px; padding: 10px 12px; border-radius: 30px; text-align: left; > span { display: grid; min-width: 0; } strong { color: var(--zalip-social-fg); overflow: hidden; text-overflow: ellipsis; } small { color: var(--zalip-social-subtle); } }
.avatar { width: 34px; height: 34px; flex: 0 0 34px; }
.indicator { width: 6px; height: 6px; border-radius: 50%; background: var(--MI_THEME-indicator); margin-left: -10px; }
@media (max-height: 780px) { .root { padding-block: 16px; } .item { min-height: 46px; font-size: 17px; } .bottom { padding-top: 14px; } .brand { padding-bottom: 16px; } }
</style>
