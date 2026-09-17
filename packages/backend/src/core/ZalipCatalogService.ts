/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { IdService } from '@/core/IdService.js';
import { NoteCreateService } from '@/core/NoteCreateService.js';
import { MiNote } from '@/models/Note.js';
import type { MiLocalUser } from '@/models/User.js';
import {
	MiZalipLibraryEntry,
	type ZalipLibraryStatus,
} from '@/models/ZalipLibraryEntry.js';
import {
	MiZalipWork,
	type ZalipPublicationState,
	type ZalipWorkKind,
} from '@/models/ZalipWork.js';
import { MiZalipNoteContext } from '@/models/ZalipNoteContext.js';

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

export type PackedZalipAdminWork = PackedZalipWork & {
	publicationState: ZalipPublicationState;
	publishedAt: string | null;
};

export type PackedZalipDiscussion = {
	noteId: string;
	created: boolean;
};

@Injectable()
export class ZalipCatalogService {
	constructor(
		@Inject(DI.db)
		private db: DataSource,

		private idService: IdService,
		private noteCreateService: NoteCreateService,
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

	public async createTmdbDraft(input: {
		tmdbMediaType: 'movie' | 'tv';
		tmdbId: number;
		title: string;
		originalTitle: string | null;
		description: string | null;
		releaseYear: number | null;
		posterPath: string | null;
		backdropPath: string | null;
		trailerYoutubeKey: string | null;
	}): Promise<MiZalipWork | 'duplicate'> {
		const repository = this.db.getRepository(MiZalipWork);
		const conflict = await repository.existsBy({
			tmdbMediaType: input.tmdbMediaType,
			tmdbId: input.tmdbId,
		});
		if (conflict) return 'duplicate';

		const now = new Date();
		return await repository.save(repository.create({
			id: this.idService.gen(),
			createdAt: now,
			updatedAt: now,
			publishedAt: null,
			slug: `tmdb-${input.tmdbMediaType}-${input.tmdbId}`,
			kind: input.tmdbMediaType === 'movie' ? 'movie' : 'series',
			publicationState: 'draft',
			title: input.title,
			originalTitle: input.originalTitle,
			description: input.description,
			releaseYear: input.releaseYear,
			tmdbMediaType: input.tmdbMediaType,
			tmdbId: input.tmdbId,
			posterPath: input.posterPath,
			backdropPath: input.backdropPath,
			trailerYoutubeKey: input.trailerYoutubeKey,
		}));
	}

	public packAdminWork(work: MiZalipWork): PackedZalipAdminWork {
		return {
			...this.packWork(work),
			publicationState: work.publicationState,
			publishedAt: work.publishedAt?.toISOString() ?? null,
		};
	}

	public async listAdminWorks(limit: number): Promise<PackedZalipAdminWork[]> {
		const works = await this.db.getRepository(MiZalipWork).find({
			order: { updatedAt: 'DESC' },
			take: limit,
		});

		return works.map(work => this.packAdminWork(work));
	}

	public async setPublicationState(
		workId: MiZalipWork['id'],
		publicationState: ZalipPublicationState,
	): Promise<PackedZalipAdminWork | null> {
		const repository = this.db.getRepository(MiZalipWork);
		const work = await repository.findOneBy({ id: workId });
		if (work == null) return null;

		const now = new Date();
		work.publicationState = publicationState;
		work.updatedAt = now;
		if (publicationState === 'published' && work.publishedAt == null) {
			work.publishedAt = now;
		}
		await repository.save(work);

		return this.packAdminWork(work);
	}

	public async showDiscussion(workId: MiZalipWork['id']): Promise<string | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			publicationState: 'published',
		});
		if (work == null) return null;

		const context = await this.db.getRepository(MiZalipNoteContext).findOneBy({ workId: work.id });
		return context?.noteId ?? null;
	}

	public async createDiscussion(
		me: MiLocalUser,
		workId: MiZalipWork['id'],
		text: string | null,
	): Promise<PackedZalipDiscussion | null> {
		const work = await this.db.getRepository(MiZalipWork).findOneBy({
			id: workId,
			publicationState: 'published',
		});
		if (work == null) return null;

		const contexts = this.db.getRepository(MiZalipNoteContext);
		const existing = await contexts.findOneBy({ workId: work.id });
		if (existing != null) return { noteId: existing.noteId, created: false };

		const note = await this.noteCreateService.fetchAndCreate(me, {
			createdAt: new Date(),
			replyId: null,
			renoteId: null,
			fileIds: [],
			text: text ?? `Обсуждение: ${work.title}`,
			cw: null,
			visibility: 'public',
			visibleUserIds: [],
			channelId: null,
			localOnly: true,
			reactionAcceptance: null,
			poll: null,
		});

		await contexts.save(contexts.create({
			workId: work.id,
			noteId: note.id,
			createdById: me.id,
			createdAt: new Date(),
		}));

		return { noteId: note.id, created: true };
	}
}
