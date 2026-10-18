/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { Ajv } from 'ajv';
import Endpoint, { meta, paramDef } from './record.js';
import { ZalipNoteViewUnavailableError } from '@/core/ZalipNoteViewService.js';

describe('secure note-view recording endpoint', () => {
	it('requires native authentication, is rate limited and accepts no caller-chosen viewer', () => {
		expect(meta).toMatchObject({ secure: true, requireCredential: true, limit: { duration: 60000, max: 120 } });
		const ajv = new Ajv(); ajv.addFormat('misskey:id', /^[A-Za-z0-9]+$/u); const validate = ajv.compile(paramDef);
		expect(validate({ noteId: 'note01' })).toBe(true);
		expect(validate({ noteId: 'note01', i: 'native-token' })).toBe(true);
		for (const value of [{ noteId: 'note01', userId: 'other' }, { noteId: 'note01', count: 100 }, { noteId: 'note01', ip: '127.0.0.1' }, { noteId: '' }, { noteId: 'a'.repeat(33) }, { noteId: '../other' }]) expect(validate(value)).toBe(false);
	});
	it('passes only the authenticated owner and exact note ID to the service', async () => {
		const record = vi.fn(async () => ({ counted: true, viewCount: 1 })); const me = { id: 'viewer01' };
		expect(await new Endpoint({ record } as never).exec({ noteId: 'note01' }, me as never, null)).toEqual({ counted: true, viewCount: 1 });
		expect(record).toHaveBeenCalledExactlyOnceWith(me, 'note01');
	});
	it('maps inaccessible/deleted notes to the same 404 without exposing private metadata', async () => {
		const record = vi.fn(async () => { throw new ZalipNoteViewUnavailableError(); });
		await expect(new Endpoint({ record } as never).exec({ noteId: 'note01' }, { id: 'viewer01' } as never, null)).rejects.toMatchObject({ code: 'NO_SUCH_NOTE', httpStatusCode: 404 });
	});
	it('does not hide unexpected storage failures as success or inaccessible content', async () => {
		const error = new Error('Storage failure'); const record = vi.fn(async () => { throw error; });
		await expect(new Endpoint({ record } as never).exec({ noteId: 'note01' }, { id: 'viewer01' } as never, null)).rejects.toBe(error);
	});
});
