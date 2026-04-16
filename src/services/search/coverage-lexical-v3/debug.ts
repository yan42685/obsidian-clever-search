const LOCAL_STORAGE_DEBUG_QUERY_KEY = "coverage-lexical-v3-debug-query";
const LOCAL_STORAGE_DEBUG_MODE_KEY = "coverage-lexical-v3-debug-mode";
const DEFAULT_DEBUG_QUERY = "st";

type DebugQueryMode = "exact" | "contains";

type DebugQueryConfig = Readonly<{
	query: string;
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
	if (config.mode === "contains") {
		return normalizedQuery.includes(config.query);
	}
	return normalizedQuery === config.query;
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
	return {
		query: configuredQuery.length > 0 ? configuredQuery : DEFAULT_DEBUG_QUERY,
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
