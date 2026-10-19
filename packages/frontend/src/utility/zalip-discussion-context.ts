/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { zalipWorkRoute } from '@/utility/zalip-work-route.js';

export type ZalipDiscussionContext = {
	workId: string;
	slug: string;
	title: string;
	posterPath: string | null;
	rootNoteId: string;
	isRoot: boolean;
	episodeId: string | null;
	episodeNumber: number | null;
	seasonNumber: number | null;
};

/** Only a server-resolved canonical context can replace a technical root's identity. */
export function zalipDiscussionContext(note: { isHidden?: boolean; deletedAt?: string | null; zalipDiscussion?: ZalipDiscussionContext } | null | undefined): ZalipDiscussionContext | null {
	return note && !note.isHidden && !note.deletedAt ? note.zalipDiscussion ?? null : null;
}

export function zalipDiscussionRoute(context: ZalipDiscussionContext): string {
	return `${zalipWorkRoute(context.slug, context.seasonNumber, context.episodeNumber)}#discussion`;
}
