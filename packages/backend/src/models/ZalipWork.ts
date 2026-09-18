/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { id } from './util/id.js';

export const zalipWorkKinds = ['movie', 'series', 'anime', 'animation'] as const;
export type ZalipWorkKind = typeof zalipWorkKinds[number];

export const zalipPublicationStates = ['draft', 'published', 'archived'] as const;
export type ZalipPublicationState = typeof zalipPublicationStates[number];

export const zalipTmdbMediaTypes = ['movie', 'tv'] as const;
export type ZalipTmdbMediaType = typeof zalipTmdbMediaTypes[number];

/**
 * A canonical Zalip title. Provider IDs and video URLs are deliberately absent: a title
 * remains stable when its metadata source or later availability provider changes.
 */
@Entity('zalip_work')
@Index(['slug'], { unique: true })
@Index(['publicationState', 'publishedAt'])
@Index(['tmdbMediaType', 'tmdbId'], { unique: true })
export class MiZalipWork {
	@PrimaryColumn(id())
	public id: string;

	@Column('timestamp with time zone')
	public createdAt: Date;

	@Column('timestamp with time zone')
	public updatedAt: Date;

	@Column('timestamp with time zone', { nullable: true })
	public publishedAt: Date | null;

	@Column('varchar', { length: 160 })
	public slug: string;

	@Column('varchar', { length: 16 })
	public kind: ZalipWorkKind;

	@Column('varchar', { length: 16, default: 'draft' })
	public publicationState: ZalipPublicationState;

	@Column('varchar', { length: 256 })
	public title: string;

	@Column('varchar', { length: 256, nullable: true })
	public originalTitle: string | null;

	@Column('varchar', { length: 8192, nullable: true })
	public description: string | null;

	@Column('integer', { nullable: true })
	public releaseYear: number | null;

	@Column('varchar', { length: 16, nullable: true })
	public tmdbMediaType: ZalipTmdbMediaType | null;

	@Column('integer', { nullable: true })
	public tmdbId: number | null;

	@Column('varchar', { length: 512, nullable: true })
	public posterPath: string | null;

	@Column('varchar', { length: 512, nullable: true })
	public backdropPath: string | null;

	/** Curated still/backdrop paths fetched from TMDB; actual image bytes remain with TMDB. */
	@Column('jsonb', { default: () => "'[]'::jsonb" })
	public galleryPaths: string[];

	@Column('varchar', { length: 32, nullable: true })
	public trailerYoutubeKey: string | null;
}
