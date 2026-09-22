/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, test, vi } from 'vitest';
import { ApiCallService } from '@/server/api/ApiCallService.js';
import Logger from '@/logger.js';
import { envOption } from '@/env.js';
import { logManager } from '@/logging/logging-runtime.js';
import { PrettyConsoleBackend } from '@/logging/PrettyConsoleBackend.js';
import type { LogBackend } from '@/logging/LogBackend.js';
import type { LogRecord } from '@/logging/types.js';

/** API失敗ログを確認するための最小Fastify応答を作成します。 */
function createReply() {
	return {
		code: vi.fn(),
		header: vi.fn(),
		send: vi.fn(),
	};
}

/** APIサービスの依存関係を最小限の仮実装へ差し替えます。 */
function createService(options: { userId?: string; rootUserId?: string | null; canSearchUsers?: boolean; isAdministrator?: boolean } = {}) {
	const authenticateService = {
		authenticate: vi.fn().mockResolvedValue([options.userId ? { id: options.userId } : null, null]),
	};
	const telemetryService = {
		startSpan: vi.fn((_name: string, callback: () => unknown) => callback()),
		captureMessage: vi.fn(),
	};
	const apiLoggerService = { logger: new Logger('api') };
	const roleService = {
		getUserRoles: vi.fn().mockResolvedValue(options.isAdministrator ? [{ isAdministrator: true }] : []),
		getUserPolicies: vi.fn().mockResolvedValue({ canSearchUsers: options.canSearchUsers ?? true }),
	};

	const service = new ApiCallService(
		{ rootUserId: options.rootUserId === undefined ? 'root' : options.rootUserId } as never,
		{} as never,
		{} as never,
		authenticateService as never,
		{} as never,
		roleService as never,
		apiLoggerService as never,
		telemetryService as never,
	);
	return { service, telemetryService, roleService };
}

describe('ApiCallService optional authentication role policies', () => {
	test.each([
		{ label: 'guest allowed', canSearchUsers: true, allowed: true },
		{ label: 'guest denied', canSearchUsers: false, allowed: false },
		{ label: 'guest denied with no root configured', rootUserId: null, canSearchUsers: false, allowed: false },
		{ label: 'member allowed', userId: 'member', canSearchUsers: true, allowed: true },
		{ label: 'member denied', userId: 'member', canSearchUsers: false, allowed: false },
		{ label: 'administrator bypass', userId: 'admin', isAdministrator: true, canSearchUsers: false, allowed: true },
		{ label: 'root bypass', userId: 'root', canSearchUsers: false, allowed: true },
	])('$label', async (options) => {
		const { service, roleService } = createService(options);
		const endpoint = {
			name: 'users/search',
			meta: { requireCredential: false, requiredRolePolicy: 'canSearchUsers' },
			params: {},
			exec: vi.fn().mockResolvedValue([]),
		};
		const reply = createReply();
		try {
			await service.handleRequest(endpoint as never, {
				method: 'POST', body: { query: 'test' }, query: {}, headers: {}, ip: '127.0.0.1',
			} as never, reply as never);
			if (options.allowed) {
				expect(endpoint.exec).toHaveBeenCalledOnce();
				expect(reply.send).toHaveBeenCalledWith([]);
			} else {
				expect(endpoint.exec).not.toHaveBeenCalled();
				expect(reply.code).toHaveBeenCalledWith(403);
				expect(reply.send).toHaveBeenCalledWith({ error: expect.objectContaining({ code: 'ROLE_PERMISSION_DENIED' }) });
			}
			if (!options.userId) {
				expect(roleService.getUserRoles).not.toHaveBeenCalled();
				expect(roleService.getUserPolicies).toHaveBeenCalledWith(null);
			}
		} finally {
			service.dispose();
		}
	});
});

describe('ApiCallService structured error logging', () => {
	test('redacts API credentials and serializes the endpoint error', async () => {
		const write = vi.fn<LogBackend['write']>();
		logManager.setBackend({ write });
		const previousQuiet = envOption.quiet;
		envOption.quiet = false;
		const { service, telemetryService } = createService();
		try {
			const reply = createReply();
			const endpoint = {
				name: 'notes/show',
				meta: {},
				params: {},
				exec: vi.fn().mockRejectedValue(new TypeError('broken endpoint')),
			};
			const request = {
				method: 'POST',
				body: {
					i: 'native-token',
					password: 'password',
					options: { visible: true },
				},
				query: {},
				headers: {},
				ip: '127.0.0.1',
			};

			await service.handleRequest(endpoint as never, request as never, reply as never);

			const record = write.mock.calls[0][0] as LogRecord;
			expect(record).toMatchObject({
				eventName: 'api.endpoint.failed',
				attributes: {
					'api.endpoint': 'notes/show',
					'api.params': {
						i: '[REDACTED]',
						password: '[REDACTED]',
						options: { visible: true },
					},
				},
				error: { type: 'TypeError', message: 'broken endpoint' },
			});
			expect(record.attributes?.['error.id']).toEqual(expect.any(String));
			expect(telemetryService.captureMessage.mock.calls[0][1].extra).not.toHaveProperty('ps');
		} finally {
			service.dispose();
			envOption.quiet = previousQuiet;
			logManager.setBackend(new PrettyConsoleBackend({ output: () => undefined }));
		}
	});
});
