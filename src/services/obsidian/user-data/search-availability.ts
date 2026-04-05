import type { LocaleKey } from "../translations/locale-helper";

export type SearchBootstrapState =
	| "blocked"
	| "restoring"
	| "healing"
	| "searchable"
	| "failed";

export type HybridQueryAvailabilityState =
	| "unavailable"
	| "lexical_only"
	| "ready"
	| "degraded";

export type HybridFreshnessState =
	| "current"
	| "updating"
	| "repairing"
	| "partial";

export type HybridHealthSummaryState =
	| "disabled"
	| "empty"
	| "ready"
	| "lexical_only"
	| "degraded"
	| "partial";

export type HybridAvailabilityReason =
	| "disabled"
	| `bootstrap_${Exclude<SearchBootstrapState, "searchable">}`
	| "runtime_gate_blocked"
	| "query_unavailable"
	| "dense_unavailable"
	| "repair_pending"
	| "embedding_incomplete";

export type LexicalAvailabilityState = {
	bootstrap: SearchBootstrapState;
	searchable: boolean;
	blockingNoticeKey: LocaleKey | null;
};

export type HybridAvailabilityState = {
	enabled: boolean;
	bootstrap: SearchBootstrapState;
	query: HybridQueryAvailabilityState;
	reasons: HybridAvailabilityReason[];
	prompt: {
		blockingNoticeKey: LocaleKey | null;
		fallbackNoticeKey: LocaleKey | null;
	};
};

export function hasHybridAvailabilityReason(
	reasons: readonly HybridAvailabilityReason[],
	reason: HybridAvailabilityReason,
): boolean {
	return reasons.includes(reason);
}

export function formatHybridAvailabilityReason(
	reason: HybridAvailabilityReason,
): string {
	switch (reason) {
		case "disabled":
			return "hybrid disabled";
		case "runtime_gate_blocked":
			return "runtime query gate blocked";
		case "query_unavailable":
			return "engine cannot serve query";
		case "dense_unavailable":
			return "dense retrieval unavailable";
		case "repair_pending":
			return "repair pending";
		case "embedding_incomplete":
			return "embedding incomplete";
		default:
			if (reason.startsWith("bootstrap_")) {
				return `bootstrap ${reason.slice("bootstrap_".length)}`;
			}
			return reason;
	}
}

export function formatHybridAvailabilityReasons(
	reasons: readonly HybridAvailabilityReason[],
): string {
	return reasons.map((reason) => formatHybridAvailabilityReason(reason)).join(" | ");
}

export function formatHybridAvailabilityRuntime(
	state: Pick<HybridAvailabilityState, "bootstrap" | "query">,
): string {
	return [`bootstrap ${state.bootstrap}`, `query ${state.query}`].join(" | ");
}

export function resolveSearchBootstrapNoticeKey(
	bootstrap: SearchBootstrapState,
): LocaleKey | null {
	switch (bootstrap) {
		case "restoring":
			return "searchBootstrap.restoring";
		case "healing":
			return "searchBootstrap.healing";
		case "failed":
			return "searchBootstrap.failed";
		default:
			return null;
	}
}

export function buildLexicalAvailabilityState(
	bootstrap: SearchBootstrapState,
): LexicalAvailabilityState {
	return {
		bootstrap,
		searchable: bootstrap === "searchable",
		blockingNoticeKey: resolveSearchBootstrapNoticeKey(bootstrap),
	};
}

export function resolveHybridQueryAvailabilityState(input: {
	enabled: boolean;
	bootstrap: SearchBootstrapState;
	runtimeGateOpen: boolean;
	canServeQuery: boolean;
	canSearch: boolean;
	hasFailures: boolean;
	hasIncompleteEmbeddings: boolean;
}): HybridQueryAvailabilityState {
	if (!input.enabled) {
		return "unavailable";
	}
	if (input.bootstrap !== "searchable") {
		return "unavailable";
	}
	if (!input.runtimeGateOpen) {
		return "unavailable";
	}
	if (!input.canServeQuery) {
		return "unavailable";
	}
	if (!input.canSearch) {
		return "lexical_only";
	}
	if (input.hasFailures || input.hasIncompleteEmbeddings) {
		return "degraded";
	}
	return "ready";
}

export function buildHybridAvailabilityState(input: {
	enabled: boolean;
	bootstrap: SearchBootstrapState;
	runtimeGateOpen: boolean;
	canServeQuery: boolean;
	canSearch: boolean;
	hasFailures: boolean;
	hasIncompleteEmbeddings: boolean;
}): HybridAvailabilityState {
	const query = resolveHybridQueryAvailabilityState(input);
	const reasons: HybridAvailabilityReason[] = [];

	if (!input.enabled) {
		reasons.push("disabled");
	} else if (input.bootstrap !== "searchable") {
		reasons.push(`bootstrap_${input.bootstrap}`);
	} else if (!input.runtimeGateOpen) {
		reasons.push("runtime_gate_blocked");
	} else if (!input.canServeQuery) {
		reasons.push("query_unavailable");
	} else if (!input.canSearch) {
		reasons.push("dense_unavailable");
	} else if (input.hasFailures) {
		reasons.push("repair_pending");
	}
	if (input.hasIncompleteEmbeddings) {
		reasons.push("embedding_incomplete");
	}

	return {
		enabled: input.enabled,
		bootstrap: input.bootstrap,
		query,
		reasons,
		prompt: {
			blockingNoticeKey: resolveSearchBootstrapNoticeKey(input.bootstrap),
			fallbackNoticeKey:
				query === "lexical_only"
					? "hybridNotice.searchFallbackToLexical"
					: null,
		},
	};
}

export function resolveHybridFreshnessState(input: {
	updatingFileCount: number;
	repairFileCount: number;
}): HybridFreshnessState {
	if (input.updatingFileCount > 0 && input.repairFileCount > 0) {
		return "partial";
	}
	if (input.updatingFileCount > 0) {
		return "updating";
	}
	if (input.repairFileCount > 0) {
		return "repairing";
	}
	return "current";
}

export function resolveHybridHealthSummaryState(input: {
	enabled: boolean;
	trackedFileCount: number;
	storedPathCount: number;
	indexedFileRefCount: number;
	readyFileCount: number;
	lexicalOnlyFileCount: number;
	unstableFileCount: number;
	updatingFileCount: number;
	repairFileCount: number;
	shadowAlignedSnapshotCount: number;
	shadowMismatchCount: number;
}): HybridHealthSummaryState {
	if (!input.enabled) {
		return "disabled";
	}
	if (input.storedPathCount === 0 && input.indexedFileRefCount === 0) {
		return "empty";
	}
	if (input.repairFileCount > 0 || input.unstableFileCount > 0) {
		return "degraded";
	}
	if (
		input.readyFileCount === 0 &&
		input.lexicalOnlyFileCount > 0 &&
		input.shadowMismatchCount === 0 &&
		input.shadowAlignedSnapshotCount === 0 &&
		input.updatingFileCount === 0
	) {
		return "lexical_only";
	}
	if (
		input.shadowMismatchCount > 0 ||
		input.shadowAlignedSnapshotCount > 0 ||
		input.updatingFileCount > 0 ||
		input.indexedFileRefCount < input.trackedFileCount
	) {
		return "partial";
	}
	return "ready";
}
