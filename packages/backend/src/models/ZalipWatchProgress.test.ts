/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { getMetadataArgsStorage } from 'typeorm';
import { MiZalipWatchProgress } from './ZalipWatchProgress.js';

const migrationUrl = new URL('../../migration/1792273818692-ZalipWatchProgressTimeProviders.js', import.meta.url);
const originalUrl = new URL('../../migration/1792257239060-ZalipWatchProgress.js', import.meta.url);
const currentCheck = '("mode" = \'time\' AND "provider" IN (\'alloha\', \'collaps\', \'kodik\')) OR ("mode" = \'episode\' AND "positionSeconds" IS NULL AND "durationSeconds" IS NULL)';
const previousCheck = '("mode" = \'time\' AND "provider" = \'kodik\') OR ("mode" = \'episode\' AND "positionSeconds" IS NULL AND "durationSeconds" IS NULL)';
type QueryRunner = { query: (sql: string) => Promise<unknown> };
type Migration = { name: string; up: (runner: QueryRunner) => Promise<void>; down: (runner: QueryRunner) => Promise<void> };
const { ZalipWatchProgressTimeProviders1792273818692 } = await import(migrationUrl.href) as { ZalipWatchProgressTimeProviders1792273818692: new () => Migration };

describe('Zalip watch-progress provider schema', () => {
	it('retains all six checks and permits time only for the closed supported provider set', () => {
		const checks = getMetadataArgsStorage().checks.filter(check => check.target === MiZalipWatchProgress);
		expect(checks.map(check => check.name).sort()).toEqual(['CHK_zalip_progress_duration', 'CHK_zalip_progress_mode', 'CHK_zalip_progress_position', 'CHK_zalip_progress_provider', 'CHK_zalip_progress_sequence', 'CHK_zalip_progress_time_provider']);
		expect(checks.find(check => check.name === 'CHK_zalip_progress_time_provider')?.expression).toBe(currentCheck);
		expect(checks.find(check => check.name === 'CHK_zalip_progress_provider')?.expression).toBe('"provider" IN (\'alloha\', \'collaps\', \'kodik\')');
		expect(checks.find(check => check.name === 'CHK_zalip_progress_duration')?.expression).toBe('"durationSeconds" IS NULL OR ("durationSeconds" > 0 AND "durationSeconds" <= 172800)');
		expect(checks.find(check => check.name === 'CHK_zalip_progress_position')?.expression).toBe('"positionSeconds" IS NULL OR ("durationSeconds" IS NOT NULL AND "positionSeconds" >= 0 AND "positionSeconds" <= "durationSeconds")');
	});

	it('up atomically replaces only the provider/time check without modifying existing progress', async () => {
		const migration = new ZalipWatchProgressTimeProviders1792273818692();
		const query = vi.fn(async (_sql: string) => undefined);
		await migration.up({ query });
		expect(migration.name).toBe('ZalipWatchProgressTimeProviders1792273818692');
		expect(query).toHaveBeenCalledExactlyOnceWith(`ALTER TABLE "zalip_watch_progress" DROP CONSTRAINT "CHK_zalip_progress_time_provider", ADD CONSTRAINT "CHK_zalip_progress_time_provider" CHECK (${currentCheck})`);
		expect(query.mock.calls[0][0]).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/u);
	});

	it('down serializes the incompatibility guard and exact old check in one atomic statement', async () => {
		const query = vi.fn(async (_sql: string) => undefined);
		await new ZalipWatchProgressTimeProviders1792273818692().down({ query });
		expect(query).toHaveBeenCalledTimes(1);
		const sql = query.mock.calls[0][0];
		expect(sql).toContain('LOCK TABLE "zalip_watch_progress" IN ACCESS EXCLUSIVE MODE;');
		expect(sql).toContain('WHERE "mode" = \'time\' AND "provider" <> \'kodik\'');
		expect(sql).toContain('USING ERRCODE = \'23514\'');
		expect(sql.indexOf('LOCK TABLE')).toBeLessThan(sql.indexOf('IF EXISTS'));
		expect(sql.indexOf('RAISE EXCEPTION')).toBeLessThan(sql.indexOf('ALTER TABLE'));
		expect(sql).toContain(`ADD CONSTRAINT "CHK_zalip_progress_time_provider" CHECK (${previousCheck})`);
		expect(sql).not.toMatch(/\b(?:UPDATE|INSERT|DELETE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/u);
	});

	it('propagates a refused downgrade instead of attempting to erase or rewrite incompatible history', async () => {
		const failure = Object.assign(new Error('Cannot downgrade while non-Kodik time progress exists'), { code: '23514' });
		const query = vi.fn(async (_sql: string) => { throw failure; });
		await expect(new ZalipWatchProgressTimeProviders1792273818692().down({ query })).rejects.toBe(failure);
		expect(query).toHaveBeenCalledTimes(1);
	});

	it('keeps the historical migration unchanged and gives the new migration an SPDX header', () => {
		expect(readFileSync(originalUrl, 'utf8')).toContain(`ADD CONSTRAINT "CHK_zalip_progress_time_provider" CHECK (${previousCheck})`);
		expect(readFileSync(migrationUrl, 'utf8')).toContain('SPDX-License-Identifier: AGPL-3.0-only');
	});
});
