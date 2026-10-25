/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Shared with the service worker; keep the existing client import path stable.
export { parseZalipWatchQuery, zalipEpisodeQuery, zalipWatchRoute, zalipWorkRoute } from '@@/js/zalip-work-route.js';
export type { ZalipWatchProvider, ZalipWatchQuery } from '@@/js/zalip-work-route.js';
