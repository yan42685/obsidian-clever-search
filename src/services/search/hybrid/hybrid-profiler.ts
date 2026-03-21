import { logger } from "src/utils/logger";
import { isDevEnvironment } from "src/utils/my-lib";

type ProfileStageStat = {
	count: number;
	totalMs: number;
	maxMs: number;
};

type HybridProfileSession = {
	label: string;
	startAt: number;
	stages: Map<string, ProfileStageStat>;
	counters: Map<string, number>;
	meta: Record<string, string | number>;
};

let currentSession: HybridProfileSession | null = null;

export function beginHybridProfile(
	label: string,
	meta: Record<string, string | number> = {},
): void {
	currentSession = {
		label,
		startAt: Date.now(),
		stages: new Map(),
		counters: new Map(),
		meta: { ...meta },
	};
}

export function endHybridProfile(
	meta: Record<string, string | number> = {},
): void {
	if (!currentSession) {
		return;
	}
	for (const [key, value] of Object.entries(meta)) {
		currentSession.meta[key] = value;
	}
	const session = currentSession;
	currentSession = null;
	if (!isDevEnvironment) {
		return;
	}

	const elapsedMs = Date.now() - session.startAt;
	console.groupCollapsed(
		`[clever-search] Hybrid profile: ${session.label} (${elapsedMs} ms)`,
	);
	if (Object.keys(session.meta).length > 0) {
		console.table([session.meta]);
	}
	console.table(
		Array.from(session.stages.entries())
			.map(([stage, stat]) => ({
				stage,
				count: stat.count,
				totalMs: Math.round(stat.totalMs),
				avgMs: Math.round(stat.totalMs / Math.max(1, stat.count)),
				maxMs: Math.round(stat.maxMs),
			}))
			.sort((left, right) => right.totalMs - left.totalMs),
	);
	if (session.counters.size > 0) {
		console.table(
			Array.from(session.counters.entries()).map(([metric, value]) => ({
				metric,
				value,
			})),
		);
	}
	console.groupEnd();
	logger.debug(`hybrid profile ${session.label} finished in ${elapsedMs} ms`);
}

export function recordHybridProfileMetric(
	name: string,
	value: number,
): void {
	if (!currentSession) {
		return;
	}
	currentSession.counters.set(
		name,
		(currentSession.counters.get(name) ?? 0) + value,
	);
}

export function setHybridProfileMeta(
	name: string,
	value: string | number,
): void {
	if (!currentSession) {
		return;
	}
	currentSession.meta[name] = value;
}

export async function profileHybridStage<T>(
	stage: string,
	work: () => Promise<T>,
): Promise<T> {
	if (!currentSession) {
		return await work();
	}
	const startedAt = Date.now();
	try {
		return await work();
	} finally {
		const elapsedMs = Date.now() - startedAt;
		const prev = currentSession.stages.get(stage) ?? {
			count: 0,
			totalMs: 0,
			maxMs: 0,
		};
		prev.count += 1;
		prev.totalMs += elapsedMs;
		prev.maxMs = Math.max(prev.maxMs, elapsedMs);
		currentSession.stages.set(stage, prev);
	}
}

export function getHybridProfileMetric(name: string): number {
	return currentSession?.counters.get(name) ?? 0;
}
