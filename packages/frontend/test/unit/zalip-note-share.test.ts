/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Misskey from 'misskey-js';
import { openZalipNoteShare } from '@/utility/zalip-note-share.js';

const controls = vi.hoisted(() => ({ menu: vi.fn().mockResolvedValue(undefined), copy: vi.fn(), native: vi.fn().mockResolvedValue(undefined), supported: false }));
vi.mock('@/os.js', () => ({ popupMenu: controls.menu }));
vi.mock('@@/js/config.js', () => ({ url: 'https://zalip.example' }));
vi.mock('@/utility/get-note-menu.js', () => ({ getCopyNoteLinkMenu: (note: Misskey.entities.Note, text: string) => ({ text, action: () => controls.copy(`https://zalip.example/notes/${note.id}`) }) }));
vi.mock('@/utility/navigator.js', () => ({ isSupportShare: () => controls.supported }));

beforeEach(() => { vi.clearAllMocks(); controls.supported = false; vi.stubGlobal('navigator', { share: controls.native }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('URL-only note sharing', () => {
	it('opens a native action menu without copying or sharing until the user chooses', () => {
		const anchor = document.createElement('button');
		openZalipNoteShare({ id: 'private-note', text: 'SECRET body', cw: 'SECRET warning' } as Misskey.entities.Note, anchor);
		expect(controls.menu.mock.calls[0][1]).toBe(anchor);
		expect(controls.menu.mock.calls[0][0]).toHaveLength(1);
		expect(controls.copy).not.toHaveBeenCalled(); expect(controls.native).not.toHaveBeenCalled();
		controls.menu.mock.calls[0][0][0].action();
		expect(controls.copy).toHaveBeenCalledExactlyOnceWith('https://zalip.example/notes/private-note');
	});
	it('passes only the canonical URL to Web Share and quietly handles cancellation', async () => {
		controls.supported = true;
		controls.native.mockRejectedValueOnce(new Error('cancelled'));
		openZalipNoteShare({ id: 'private-note', text: 'SECRET body', cw: 'SECRET warning', url: 'https://foreign.example/SECRET' } as Misskey.entities.Note);
		expect(controls.menu.mock.calls[0][0]).toHaveLength(2);
		controls.menu.mock.calls[0][0][1].action();
		await Promise.resolve();
		expect(controls.native).toHaveBeenCalledExactlyOnceWith({ url: 'https://zalip.example/notes/private-note' });
	});
});
