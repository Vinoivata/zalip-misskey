/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it, vi } from 'vitest';
import { DataSource, EntitySchema } from 'typeorm';
import { ZalipCatalogService } from '@/core/ZalipCatalogService.js';
import { MiZalipWork } from '@/models/ZalipWork.js';
import { cataloguePageScope, encodeCataloguePageCursor } from '@/misc/zalip-catalogue-page.js';

class MetadataOnlyDataSource extends DataSource {
	async prepare() { await this.buildMetadatas(); }
}

async function harness() {
	const db = new MetadataOnlyDataSource({
		type: 'postgres', entities: [new EntitySchema({
			name: 'MiZalipWork', target: MiZalipWork,
			columns: {
				id: { type: String, primary: true }, title: { type: String }, originalTitle: { type: String, nullable: true },
				publicationState: { type: String }, publishedAt: { type: Date, nullable: true }, createdAt: { type: Date },
				releaseYear: { type: Number, nullable: true }, kind: { type: String }, genres: { type: 'jsonb' },
			},
		})],
	});
	await db.prepare();
	const runner = db.createQueryRunner();
	const queries = vi.spyOn(runner, 'query').mockImplementation(async (sql: string) => ({ records: sql.includes('COUNT(') ? [{ cnt: '113' }] : [], raw: [] }));
	vi.spyOn(runner, 'release').mockResolvedValue();
	vi.spyOn(db, 'createQueryRunner').mockReturnValue(runner);
	return { service: new ZalipCatalogService(db, {} as never, {} as never, {} as never), queries };
}

describe('whole-catalogue TypeORM keyset SQL', () => {
	it.each(['newest', 'oldest', 'year-desc', 'year-asc', 'title'] as const)('counts every match before the %s cursor boundary and globally orders before LIMIT', async sort => {
		const h = await harness();
		const filters = { genres: ['Драма'], kinds: ['movie'] as const, query: '100%_Title', yearFrom: 2000, yearTo: 2026 };
		const scope = cataloguePageScope({ ...filters, kinds: [...filters.kinds] });
		const value = sort === 'title' ? 'Title 050' : sort.startsWith('year-') ? 2015 : '2026-10-16T12:00:00.000Z';
		const result = await h.service.pagePublished(24, { ...filters, kinds: [...filters.kinds] }, sort, encodeCataloguePageCursor(scope, sort, { id: 'work050', value }));
		expect(result).toEqual({ items: [], total: 113, nextCursor: null });
		const count = h.queries.mock.calls.find(([sql]) => sql.includes('COUNT('));
		const page = h.queries.mock.calls.find(([sql]) => !sql.includes('COUNT('));
		expect(count?.[0]).toContain('"work"."publicationState" = $1');
		expect(count?.[1]).not.toContain('work050');
		expect(page?.[1]).toContain('work050');
		expect(page?.[1]).toContain('%100\\%\\_Title%');
		expect(page?.[0]).toContain('LIMIT 25');
		expect(page?.[0]).not.toContain('OFFSET');
		expect(page?.[0]).toContain('NULLS LAST');
		expect(page?.[0]).toContain('"work"."id"');
		if (sort === 'title') expect(page?.[0]).toContain('LOWER("work"."title")');
		else if (sort.startsWith('year-')) expect(page?.[0]).toContain('OR "work"."releaseYear" IS NULL');
		else expect(page?.[0]).toContain("DATE_TRUNC('milliseconds', COALESCE(\"work\".\"publishedAt\", \"work\".\"createdAt\"))");
	});
	it('continues deterministically within the null-year tail', async () => {
		const h = await harness();
		const scope = cataloguePageScope({ genres: [], kinds: [], query: '' });
		await h.service.pagePublished(24, {}, 'year-desc', encodeCataloguePageCursor(scope, 'year-desc', { id: 'work050', value: null }));
		const page = h.queries.mock.calls.find(([sql]) => !sql.includes('COUNT('));
		expect(page?.[0]).toContain('"work"."releaseYear" IS NULL AND "work"."id" <');
	});
});
