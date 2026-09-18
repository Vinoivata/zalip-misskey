/*
 * SPDX-FileCopyrightText: Zalip contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import type Logger from '@/logger.js';
import { bindThis } from '@/decorators.js';
import { ZalipAllohaService } from '@/core/ZalipAllohaService.js';
import { QueueLoggerService } from '../QueueLoggerService.js';

/** Runs the bounded Alloha provider sync through Misskey's own repeatable system queue. */
@Injectable()
export class SyncZalipAllohaProcessorService {
	private logger: Logger;

	constructor(
		private zalipAllohaService: ZalipAllohaService,
		private queueLoggerService: QueueLoggerService,
	) {
		this.logger = this.queueLoggerService.logger.createSubLogger('sync-zalip-alloha');
	}

	@bindThis
	public async process(): Promise<void> {
		const result = await this.zalipAllohaService.sync();
		if (result.kind === 'not-configured') {
			this.logger.warn('Alloha sync skipped because the server credential is not configured.');
			return;
		}
		if (result.kind === 'upstream-failure') {
			throw new Error('Alloha API sync failed.');
		}
		this.logger.succ(`Alloha sync complete: checked=${result.checked}, available=${result.available}, new=${result.events}.`);
	}
}
