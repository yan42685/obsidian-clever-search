export type HybridProviderFailureKind =
	| 'missing_api_key'
	| 'weekly_token_limit'
	| 'quota_exhausted'
	| 'auth_401'
	| 'auth_403'
	| 'provider_429'
	| 'timeout'
	| 'provider_5xx'
	| 'network'
	| 'unknown';

export type HybridProviderErrorDetails = {
	kind: HybridProviderFailureKind;
	status?: number;
	providerCode?: string | null;
	providerType?: string | null;
	providerMessage?: string | null;
	requestId?: string | null;
	retryAfterHeader?: string | null;
};

export type HybridSearchIssue = {
	kind: HybridProviderFailureKind | 'none';
	message: string | null;
};

type DashScopeErrorEnvelope = {
	code?: unknown;
	message?: unknown;
	request_id?: unknown;
	requestId?: unknown;
	error?: {
		message?: unknown;
		type?: unknown;
		code?: unknown;
	};
};

export class NoApiKeyError extends Error {
	constructor() {
		super('No Qwen API key configured; falling back to lexical-only search');
		this.name = 'NoApiKeyError';
	}
}

export class WeeklyTokenLimitExceededError extends Error {
	readonly limit: number;
	readonly used: number;
	readonly estimated: number;

	constructor(limit: number, used: number, estimated: number) {
		super('Weekly token limit exceeded before sending provider request');
		this.name = 'WeeklyTokenLimitExceededError';
		this.limit = limit;
		this.used = used;
		this.estimated = estimated;
	}
}

export function buildHybridProviderErrorDetails(
	status: number,
	body: string,
	retryAfterHeader?: string | null,
): HybridProviderErrorDetails {
	const parsed = parseHybridProviderErrorBody(body);
	return {
		kind: classifyHybridProviderFailureFromHttp(
			status,
			[
				parsed.providerMessage,
				parsed.providerCode,
				parsed.providerType,
			]
				.filter((value): value is string => Boolean(value))
				.join(' '),
		),
		status,
		providerCode: parsed.providerCode,
		providerType: parsed.providerType,
		providerMessage: parsed.providerMessage,
		requestId: parsed.requestId,
		retryAfterHeader,
	};
}

export function classifyHybridProviderFailure(
	error: unknown,
): HybridProviderFailureKind {
	if (error instanceof NoApiKeyError) {
		return 'missing_api_key';
	}
	if (error instanceof WeeklyTokenLimitExceededError) {
		return 'weekly_token_limit';
	}
	if (!(error instanceof Error)) {
		return 'unknown';
	}

	const message = `${error.name}: ${error.message}`.toLowerCase();
	if (isQuotaFailureMessage(message)) {
		return 'quota_exhausted';
	}

	const statusMatch = message.match(/\bapi error (\d{3})\b/);
	if (statusMatch) {
		return classifyHybridProviderFailureFromHttp(
			Number(statusMatch[1]),
			message,
		);
	}

	if (error.name === 'AbortError' || message.includes('timeout')) {
		return 'timeout';
	}
	if (isNetworkFailureMessage(message)) {
		return 'network';
	}
	return 'unknown';
}

export function classifyHybridProviderFailureFromHttp(
	status: number,
	detailText = '',
): HybridProviderFailureKind {
	const normalizedDetail = detailText.toLowerCase();
	if (isQuotaFailureMessage(normalizedDetail)) {
		return 'quota_exhausted';
	}
	if (status === 401) {
		return 'auth_401';
	}
	if (status === 403) {
		return 'auth_403';
	}
	if (status === 408) {
		return 'timeout';
	}
	if (status === 409 || status === 425 || status === 429) {
		return 'provider_429';
	}
	if (status >= 500) {
		return 'provider_5xx';
	}
	return 'unknown';
}

export function parseHybridProviderErrorBody(body: string): {
	providerMessage: string | null;
	providerCode: string | null;
	providerType: string | null;
	requestId: string | null;
} {
	const trimmed = body.trim();
	if (!trimmed) {
		return {
			providerMessage: null,
			providerCode: null,
			providerType: null,
			requestId: null,
		};
	}

	try {
		const parsed = JSON.parse(trimmed) as DashScopeErrorEnvelope;
		const errorObject =
			parsed.error && typeof parsed.error === 'object' ? parsed.error : null;
		return {
			providerMessage: readProviderString(
				errorObject?.message ?? parsed.message,
			),
			providerCode: readProviderString(errorObject?.code ?? parsed.code),
			providerType: readProviderString(errorObject?.type),
			requestId: readProviderString(parsed.request_id ?? parsed.requestId),
		};
	} catch {
		return {
			providerMessage: trimmed,
			providerCode: null,
			providerType: null,
			requestId: null,
		};
	}
}

export function isNetworkFailureMessage(message: string): boolean {
	return (
		message.includes('failed to fetch') ||
		message.includes('network') ||
		message.includes('econn') ||
		message.includes('socket')
	);
}

export function isQuotaFailureMessage(message: string): boolean {
	return (
		message.includes('allocationquota.freetieronly') ||
		message.includes('free tier') ||
		message.includes('free-tier') ||
		message.includes('insufficient_quota') ||
		message.includes('quota exhausted') ||
		message.includes('quota exceeded') ||
		message.includes('exceeded your current quota') ||
		message.includes('arrearage') ||
		message.includes('billing') ||
		message.includes('free quota')
	);
}

export function buildHybridFallbackNoticeMessage(error: unknown): string | null {
	if (error instanceof NoApiKeyError) {
		return 'Qwen API key is not configured.';
	}
	if (error instanceof WeeklyTokenLimitExceededError) {
		return `Weekly token limit exceeded before sending provider request (limit: ${error.limit}, used: ${error.used}, estimated: ${error.estimated}).`;
	}
	if (!(error instanceof Error)) {
		return null;
	}

	const providerMessage = readProviderString(
		(error as { providerMessage?: unknown }).providerMessage,
	);
	const requestId = readProviderString(
		(error as { requestId?: unknown }).requestId,
	);
	if (providerMessage) {
		return requestId
			? `${providerMessage} (request_id: ${requestId})`
			: providerMessage;
	}

	const message = error.message.trim();
	return message.length > 0 ? message : null;
}

export function buildHybridSearchIssue(error: unknown): HybridSearchIssue {
	if (!error) {
		return {
			kind: 'none',
			message: null,
		};
	}
	if (error instanceof NoApiKeyError) {
		return {
			kind: 'missing_api_key',
			message: null,
		};
	}
	if (error instanceof WeeklyTokenLimitExceededError) {
		return {
			kind: 'weekly_token_limit',
			message: null,
		};
	}
	if (!(error instanceof Error)) {
		return {
			kind: 'unknown',
			message: null,
		};
	}

	const providerMessage = readProviderString(
		(error as { providerMessage?: unknown }).providerMessage,
	);
	const providerCode = readProviderString(
		(error as { providerCode?: unknown }).providerCode,
	);
	const providerType = readProviderString(
		(error as { providerType?: unknown }).providerType,
	);
	const requestId = readProviderString(
		(error as { requestId?: unknown }).requestId,
	);
	const enrichedDetail = [
		providerMessage,
		providerCode,
		providerType,
		error.message,
	]
		.filter((value): value is string => Boolean(value))
		.join(' ')
		.toLowerCase();
	let kind = classifyHybridProviderFailure(error);
	if (isQuotaFailureMessage(enrichedDetail)) {
		kind = 'quota_exhausted';
	}

	if (providerMessage) {
		return {
			kind,
			message: requestId
				? `${providerMessage} (request_id: ${requestId})`
				: providerMessage,
		};
	}

	return {
		kind,
		message: kind === 'unknown' ? buildHybridFallbackNoticeMessage(error) : null,
	};
}

function readProviderString(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0
		? value.trim()
		: null;
}
