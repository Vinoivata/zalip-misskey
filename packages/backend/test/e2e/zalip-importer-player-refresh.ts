/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

process.env.NODE_ENV = 'test';

import * as assert from 'node:assert';
import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, test } from 'vitest';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { MiZalipExternalIdentity } from '@/models/ZalipExternalIdentity.js';
import { MiZalipImportItem, MiZalipImportRun } from '@/models/ZalipImportRun.js';
import { api, createAppToken, initTestDb, relativeFetch, signup } from '../utils.js';
import type { DataSource } from 'typeorm';
import type { SignupResponse } from 'misskey-js/entities.js';

type RefreshResult = { workId: string; source: 'vibix'; status: string; runId: string | null; playbackRevision: string };
type ResponseBody = RefreshResult & { error?: { code: string } };

/** Run only in the isolated no-egress HTTP harness, with fresh synthetic DB/Redis,
 * no queue worker, and server env ZALIP_VIBIX_API_TOKEN=synthetic-http-fixture.
 * All other provider credentials must be absent. No actual provider is queried:
 * a queued journal is inspected/cancelled, never processed. Missing configuration
 * is a hard failure, not a skipped or substituted success case.
 */
describe('Zalip existing-title players-only refresh HTTP API', () => {
	let admin: SignupResponse; let reader: SignupResponse; let db: DataSource;
	const endpoint = 'zalip/admin/importer/work-state/refresh-players';
	const id = () => randomUUID().replaceAll('-', '');
	beforeAll(async () => {
		db = await initTestDb(true);
		admin = await signup({ username: 'playerrefreshadmin' });
		reader = await signup({ username: 'playerrefreshreader' });
		const sources = await api('zalip/admin/importer/sources', {}, admin);
		assert.strictEqual(sources.status, 200, 'isolated fixture administrator must authenticate');
		const configured = sources.body.sources as { source: string; configured: boolean }[];
		assert.ok(Array.isArray(configured));
		assert.deepStrictEqual(configured.filter(source => source.configured).map(source => source.source), ['vibix'], 'start isolated HTTP server with only the synthetic Vibix credential and without a worker');
	}, 120000);
	afterAll(async () => { if (db.isInitialized) await db.destroy(); });

	async function call(params: Record<string, unknown>, viewer?: { token: string }) {
		const response = await relativeFetch(`api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(viewer ? { i: viewer.token } : {}), ...params }), redirect: 'manual' });
		return { status: response.status, body: await response.json() as ResponseBody };
	}

	async function target(options: { tmdb?: boolean; locks?: string[]; ambiguous?: boolean } = {}) {
		const workId = id(); const now = new Date(); const tmdbId = randomInt(100000000, 200000000); const kpId = String(randomInt(200000000, 300000000));
		await db.getRepository(MiZalipWork).insert({ id: workId, slug: `refresh-${workId}`, title: 'Editorial synthetic title', description: 'Editorial description must not change', kind: 'movie', publicationState: 'published', publishedAt: now, createdAt: now, updatedAt: now, tmdbId: options.tmdb === false ? null : tmdbId, tmdbMediaType: options.tmdb === false ? null : 'movie', posterPath: '/local-editorial-poster.webp', importData: { locks: options.locks ?? ['title', 'posterUrl'], values: { players: [] } } });
		await db.getRepository(MiZalipExternalIdentity).insert({ id: id(), workId, provider: 'kinopoisk', externalId: kpId, entityType: 'movie', updatedAt: now });
		if (options.ambiguous) await db.getRepository(MiZalipExternalIdentity).insert({ id: id(), workId, provider: 'kinopoisk', externalId: `${kpId}1`, entityType: 'movie', updatedAt: now });
		const state = await api('zalip/admin/importer/work-state/show', { workId }, admin);
		assert.strictEqual(state.status, 200);
		const revision = (state.body as { playbackRevision: string }).playbackRevision;
		assert.match(revision, /^[a-f0-9]{64}$/u);
		return { workId, kpId, revision };
	}

	async function journalCount() { return db.getRepository(MiZalipImportRun).count(); }

	test('rejects anonymous, ordinary users and application credentials before creating a journal', async () => {
		const input = { workId: id(), source: 'vibix', expected: 'a'.repeat(64) };
		const before = await journalCount();
		const guest = await call(input);
		assert.strictEqual(guest.status, 400); assert.strictEqual(guest.body.error?.code, 'ACCESS_DENIED');
		const denied = await call(input, reader);
		assert.strictEqual(denied.status, 403); assert.strictEqual(denied.body.error?.code, 'ZALIP_ADMIN_REQUIRED');
		const token = await createAppToken(admin, ['write:account']);
		const application = await call(input, { token });
		assert.strictEqual(application.status, 400); assert.strictEqual(application.body.error?.code, 'ACCESS_DENIED');
		assert.strictEqual(await journalCount(), before);
	});

	test('strictly rejects alternate sources and client-controlled import options', async () => {
		const input = { workId: id(), source: 'vibix', expected: 'a'.repeat(64) };
		const before = await journalCount();
		for (const change of [{ source: 'collaps' }, { expected: 'A'.repeat(64) }, { source: undefined }, { fields: ['title'] }, { lockedFields: [] }, { categoryIds: ['other'] }, { profileId: 'other' }, { mode: 'import' }, { token: 'not-accepted' }, { externalId: '1' }, { url: 'https://example.org' }]) {
			const response = await call({ ...input, ...change }, admin);
			assert.strictEqual(response.status, 400, JSON.stringify(response.body)); assert.strictEqual(response.body.error?.code, 'INVALID_PARAM');
		}
		assert.strictEqual(await journalCount(), before);
	});

	test('queues exactly one native availability item, preserves the title and blocks a duplicate queued action', async () => {
		const fixture = await target(); const works = db.getRepository(MiZalipWork);
		const before = await works.findOneByOrFail({ id: fixture.workId }); const beforeCount = await works.count();
		const input = { workId: fixture.workId, source: 'vibix', expected: fixture.revision };
		const response = await call(input, admin);
		assert.strictEqual(response.status, 200, JSON.stringify(response.body));
		assert.strictEqual(response.body.status, 'queued'); assert.ok(response.body.runId);
		assert.strictEqual(response.body.playbackRevision, fixture.revision);
		const run = await db.getRepository(MiZalipImportRun).findOneByOrFail({ id: response.body.runId });
		assert.deepStrictEqual({ mode: run.mode, state: run.state, createdById: run.createdById, profileId: run.profileId, lockedFields: run.lockedFields, categoryIds: run.categoryIds, options: run.options }, { mode: 'availability', state: 'queued', createdById: admin.id, profileId: null, lockedFields: [], categoryIds: [], options: { sources: ['vibix'], fields: ['players'] } });
		const items = await db.getRepository(MiZalipImportItem).findBy({ runId: run.id });
		assert.strictEqual(items.length, 1); assert.strictEqual(items[0].workId, fixture.workId);
		assert.deepStrictEqual(items[0].ref, { source: 'vibix', externalId: fixture.kpId, mediaType: 'movie' });
		assert.strictEqual((await call(input, admin)).body.status, 'busy');
		assert.deepStrictEqual(await works.findOneByOrFail({ id: fixture.workId }), before); assert.strictEqual(await works.count(), beforeCount);
		// Only synthetic fixture journals are cancelled; no worker is ever started.
		await db.getRepository(MiZalipImportRun).update(run.id, { state: 'cancelled' });
	});

	test('stale and locked targets do not create a run or alter saved locks', async () => {
		const fixture = await target({ locks: ['players', 'title'] }); const before = await journalCount();
		const snapshot = await db.getRepository(MiZalipWork).findOneByOrFail({ id: fixture.workId });
		const stale = await call({ workId: fixture.workId, source: 'vibix', expected: '0'.repeat(64) }, admin);
		assert.strictEqual(stale.status, 200); assert.strictEqual(stale.body.status, 'stale'); assert.strictEqual(stale.body.runId, null);
		const locked = await call({ workId: fixture.workId, source: 'vibix', expected: fixture.revision }, admin);
		assert.strictEqual(locked.status, 200); assert.strictEqual(locked.body.status, 'locked'); assert.strictEqual(locked.body.runId, null);
		assert.strictEqual(await journalCount(), before); assert.deepStrictEqual(await db.getRepository(MiZalipWork).findOneByOrFail({ id: fixture.workId }), snapshot);
	});

	test('unsupported, ambiguous and absent canonical targets cannot create titles or runs', async () => {
		const unsupported = await target({ tmdb: false }); const ambiguous = await target({ ambiguous: true });
		const count = await journalCount(); const works = await db.getRepository(MiZalipWork).count();
		for (const [fixture, expected] of [[unsupported, 'unsupported'], [ambiguous, 'ambiguous']] as const) {
			const response = await call({ workId: fixture.workId, source: 'vibix', expected: fixture.revision }, admin);
			assert.strictEqual(response.status, 200); assert.strictEqual(response.body.status, expected); assert.strictEqual(response.body.runId, null);
		}
		const missing = await call({ workId: id(), source: 'vibix', expected: 'a'.repeat(64) }, admin);
		assert.strictEqual(missing.status, 404); assert.strictEqual(missing.body.error?.code, 'ZALIP_IMPORT_NOT_FOUND');
		assert.strictEqual(await journalCount(), count); assert.strictEqual(await db.getRepository(MiZalipWork).count(), works);
	});

	test('a paused unbound canonical reference is protected from a duplicate refresh', async () => {
		const fixture = await target(); const runId = id(); const now = new Date();
		await db.getRepository(MiZalipImportRun).insert({ id: runId, createdAt: now, updatedAt: now, createdById: admin.id, mode: 'sync', state: 'paused', lockedFields: [], categoryIds: [], options: {} });
		await db.getRepository(MiZalipImportItem).insert({ id: id(), runId, position: 0, ref: { source: 'kinopoisk', externalId: fixture.kpId, mediaType: 'movie' }, workId: null, state: 'pending', warnings: [], updatedAt: now });
		const before = await journalCount();
		const response = await call({ workId: fixture.workId, source: 'vibix', expected: fixture.revision }, admin);
		assert.strictEqual(response.status, 200); assert.strictEqual(response.body.status, 'busy'); assert.strictEqual(response.body.runId, null);
		assert.strictEqual(await journalCount(), before);
		await db.getRepository(MiZalipImportRun).update(runId, { state: 'cancelled' });
	});
});
