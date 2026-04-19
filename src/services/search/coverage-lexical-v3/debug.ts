const LOCAL_STORAGE_DEBUG_QUERY_KEY = "coverage-lexical-v3-debug-query";
const LOCAL_STORAGE_DEBUG_MODE_KEY = "coverage-lexical-v3-debug-mode";
const DEFAULT_DEBUG_QUERIES = ["s", "st", "赢宋功", "功赢宋"] as const;

type DebugQueryMode = "exact" | "contains";

type DebugQueryConfig = Readonly<{
	queries: readonly string[];
	mode: DebugQueryMode;
}>;

export function nowDebugMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function shouldLogCoverageLexicalV3Debug(queryText: string): boolean {
	const normalizedQuery = queryText.trim();
	if (normalizedQuery.length === 0) {
		return false;
	}
	const config = resolveDebugQueryConfig();
	if (config.queries.length === 0) {
		return false;
	}
	if (config.mode === "contains") {
		return config.queries.some((query) => normalizedQuery.includes(query));
	}
	return config.queries.some((query) => normalizedQuery === query);
}

export function logCoverageLexicalV3Debug(
	label: string,
	payload: Record<string, unknown>,
): void {
	console.log(`[coverage-lexical-v3-debug] ${label}`, payload);
}

function resolveDebugQueryConfig(): DebugQueryConfig {
	const localStorage = readLocalStorageSafely();
	const configuredQuery =
		localStorage?.getItem(LOCAL_STORAGE_DEBUG_QUERY_KEY)?.trim() ?? "";
	const configuredMode =
		localStorage?.getItem(LOCAL_STORAGE_DEBUG_MODE_KEY)?.trim() ?? "";
	const configuredQueries = configuredQuery
		.split(",")
		.map((query) => query.trim())
		.filter((query) => query.length > 0);
	return {
		queries:
			configuredQueries.length > 0
				? configuredQueries
				: [...DEFAULT_DEBUG_QUERIES],
		mode: configuredMode === "contains" ? "contains" : "exact",
	};
}

function readLocalStorageSafely(): Storage | null {
	if (typeof window === "undefined" || window.localStorage == null) {
		return null;
	}
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
