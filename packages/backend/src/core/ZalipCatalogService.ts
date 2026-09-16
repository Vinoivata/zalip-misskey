/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import type { MiLocalUser } from '@/models/User.js';
import {
	MiZalipLibraryEntry,
	type ZalipLibraryStatus,
} from '@/models/ZalipLibraryEntry.js';
import {
	MiZalipWork,
	type ZalipWorkKind,
} from '@/models/ZalipWork.js';

export type PackedZalipWork = {
	id: string;
	slug: string;
	kind: ZalipWorkKind;
	title: string;
	originalTitle: string | null;
	description: string | null;
	releaseYear: number | null;
	posterPath: string | null;
	backdropPath: string | null;
	trailerYoutubeKey: string | null;
};

export type PackedZalipLibraryEntry = {
	status: ZalipLibraryStatus;
	episodesWatched: number;
	personalRating: number | null;
	isFavorite: boolean;
	work: PackedZalipWork;
};

@Injectable()
export class ZalipCatalogService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
	) {
	}

	public packWork(work: MiZalipWork): PackedZalipWork {
		return {
			id: work.id,
			slug: work.slug,
			kind: work.kind,
			title: work.title,
			originalTitle: work.originalTitle,
			description: work.description,
			releaseYear: work.releaseYear,
			posterPath: work.posterPath,
			backdropPath: work.backdropPath,
			trailerYoutubeKey: work.trailerYoutubeKey,
		};
	}

	public async listPublished(limit: number): Promise<PackedZalipWork[]> {
		const works = await this.db.getRepository(MiZalipWork).find({
			where: { publicationState: 'published' },
			order: { publishedAt: 'DESC', createdAt: 'DESC' },
			take: limit,
		});

		return works.map(work => this.packWork(work));
	}

	public async showPublished(slug: string): Promise<PackedZalipWork | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			slug,
			publicationState: 'published',
		});

		return work == null ? null : this.packWork(work);
	}

	public async listLibrary(me: MiLocalUser): Promise<PackedZalipLibraryEntry[]> {
		const entries = await this.db.getRepository(MiZalipLibraryEntry).createQueryBuilder('entry')
			.innerJoinAndSelect('entry.work', 'work')
			.where('entry.userId = :userId', { userId: me.id })
			.andWhere('work.publicationState = :publicationState', { publicationState: 'published' })
			.orderBy('entry.updatedAt', 'DESC')
			.getMany();

		return entries.map(entry => ({
			status: entry.status,
			episodesWatched: entry.episodesWatched,
			personalRating: entry.personalRating,
			isFavorite: entry.isFavorite,
			work: this.packWork(entry.work!),
		}));
	}

	public async updateLibrary(
		me: MiLocalUser,
		workId: MiZalipWork['id'],
		input: {
			status: ZalipLibraryStatus;
			episodesWatched?: number;
			personalRating?: number | null;
			isFavorite?: boolean;
		},
	): Promise<PackedZalipLibraryEntry | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			publicationState: 'published',
		});
		if (work == null) return null;

		const repository = this.db.getRepository(MiZalipLibraryEntry);
		const existing = await repository.findOneBy({ userId: me.id, workId: work.id });
		const now = new Date();
		const entry = existing ?? repository.create({
			userId: me.id,
			workId: work.id,
			createdAt: now,
		});

		entry.status = input.status;
		entry.episodesWatched = input.episodesWatched ?? existing?.episodesWatched ?? 0;
		entry.personalRating = input.personalRating === undefined ? (existing?.personalRating ?? null) : input.personalRating;
		entry.isFavorite = input.isFavorite ?? existing?.isFavorite ?? false;
		entry.updatedAt = now;
		await repository.save(entry);

		return {
			status: entry.status,
			episodesWatched: entry.episodesWatched,
			personalRating: entry.personalRating,
			isFavorite: entry.isFavorite,
			work: this.packWork(work),
		};
	}

	public async createManualDraft(input: {
		slug: string;
		kind: ZalipWorkKind;
		title: string;
		originalTitle?: string | null;
		description?: string | null;
		releaseYear?: number | null;
	}): Promise<MiZalipWork | 'duplicate'> {
		const repository = this.db.getRepository(MiZalipWork);
		const conflict = await repository.existsBy({ slug: input.slug });
		if (conflict) return 'duplicate';

		const now = new Date();
		return await repository.save(repository.create({
			id: this.idService.gen(),
			createdAt: now,
			updatedAt: now,
			publishedAt: null,
			slug: input.slug,
			kind: input.kind,
			publicationState: 'draft',
			title: input.title,
			originalTitle: input.originalTitle ?? null,
			description: input.description ?? null,
			releaseYear: input.releaseYear ?? null,
			tmdbMediaType: null,
			tmdbId: null,
			posterPath: null,
			backdropPath: null,
			trailerYoutubeKey: null,
		}));
	}
}
