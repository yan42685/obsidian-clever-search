type FileSearchPlannerField =
	| "basename"
	| "aliases"
	| "folder"
	| "tags"
	| "headings"
	| "content";

// The planner keeps lexical search behavior understandable:
// try the original all-terms path first, then selectively relax only for
// longer or noisier queries where strict matching is too brittle.

export type FileSearchQueryKind =
	| "short_anchor"
	| "path_like"
	| "mixed"
	| "sentence_like";

export type FileSearchQueryTermStats = {
	index: number;
	queryTerm: string;
	matchedDocCount: number;
	matchedMetadataDocCount: number;
	hasAnyMatch: boolean;
	hasExactMatch: boolean;
};

export type FileSearchPlannerDocState = {
	matchedQueryTerms: ReadonlySet<number>;
	matchedMetadataQueryTerms: ReadonlySet<number>;
	matchedQueryTermsByField: ReadonlyMap<
		FileSearchPlannerField,
		ReadonlySet<number>
	>;
};

export type FileSearchPlannerMode = "strict" | "relaxed";

export type FileSearchQueryPlanner = {
	queryKind: FileSearchQueryKind;
	strictTermCount: number;
	activeTermCount: number;
	anchorTermIndexes: ReadonlySet<number>;
	relaxedMinimumMatchCount: number;
	shouldUseRelaxedResults(strictResultCount: number, maxItemResults: number): boolean;
	matches(docState: FileSearchPlannerDocState, mode: FileSearchPlannerMode): boolean;
	computeScoreBonus(
		docState: FileSearchPlannerDocState,
		mode: FileSearchPlannerMode,
	): number;
};

const PATH_HINT_REGEX = /[\\/]|(?:^|\s)tag:|(?:^|\s)path:|[#.][\p{L}\d_-]+/iu;
const EXTENSION_HINT_REGEX = /\.[a-z0-9]{1,6}\b/i;

export function createFileSearchQueryPlanner(params: {
	rawQueryText: string;
	queryTerms: string[];
	termStats: FileSearchQueryTermStats[];
	docCount: number;
}): FileSearchQueryPlanner {
	const { rawQueryText, queryTerms, termStats, docCount } = params;
	const queryKind = classifyFileSearchQuery(rawQueryText, queryTerms);
	const matchedStats = termStats.filter((stat) => stat.hasAnyMatch);
	const matchedTermIndexes = new Set(matchedStats.map((stat) => stat.index));
	const optionalTermIndexes = selectOptionalTermIndexes(
		matchedStats,
		docCount,
		queryKind,
	);
	const anchorTermIndexes = selectAnchorTermIndexes(
		matchedStats,
		optionalTermIndexes,
		queryKind,
	);
	const strictTermCount = queryTerms.length;
	const activeTermCount = matchedStats.length;
	const effectiveRequiredTermCount = Math.max(
		anchorTermIndexes.size,
		activeTermCount - optionalTermIndexes.size,
	);
	const relaxedMinimumMatchCount = computeRelaxedMinimumMatchCount(
		queryKind,
		anchorTermIndexes.size,
		effectiveRequiredTermCount,
		activeTermCount,
	);
	const metadataAnchorTermIndexes = new Set<number>();
	for (const stat of matchedStats) {
		if (
			anchorTermIndexes.has(stat.index) &&
			stat.matchedMetadataDocCount > 0
		) {
			metadataAnchorTermIndexes.add(stat.index);
		}
	}

	return {
		queryKind,
		strictTermCount,
		activeTermCount,
		anchorTermIndexes,
		relaxedMinimumMatchCount,
		shouldUseRelaxedResults(strictResultCount, maxItemResults) {
			if (
				strictTermCount <= 2 ||
				activeTermCount < 2 ||
				queryKind === "short_anchor" ||
				anchorTermIndexes.size === 0
			) {
				return false;
			}
			if (strictResultCount === 0) {
				return true;
			}
			const threshold =
				queryKind === "sentence_like"
					? Math.max(2, Math.floor(maxItemResults / 3))
					: Math.max(1, Math.floor(maxItemResults / 4));
			return strictResultCount < threshold;
		},
		matches(docState, mode) {
			const matchedCount = countOverlap(
				docState.matchedQueryTerms,
				matchedTermIndexes,
			);
			if (mode === "strict") {
				return activeTermCount === strictTermCount && matchedCount === strictTermCount;
			}

			if (
				countOverlap(docState.matchedQueryTerms, anchorTermIndexes) !==
				anchorTermIndexes.size
			) {
				return false;
			}
			if (
				queryKind === "path_like" &&
				metadataAnchorTermIndexes.size > 0 &&
				countOverlap(
					docState.matchedMetadataQueryTerms,
					metadataAnchorTermIndexes,
				) === 0
			) {
				return false;
			}
			const nonOptionalMatchedCount = countMatchedTermsExcluding(
				docState.matchedQueryTerms,
				optionalTermIndexes,
			);
			return nonOptionalMatchedCount >= relaxedMinimumMatchCount;
		},
		computeScoreBonus(docState, mode) {
			const matchedCount = docState.matchedQueryTerms.size;
			const metadataCount = docState.matchedMetadataQueryTerms.size;
			const anchorMatches = countOverlap(
				docState.matchedQueryTerms,
				anchorTermIndexes,
			);
			const metadataAnchorMatches = countOverlap(
				docState.matchedMetadataQueryTerms,
				anchorTermIndexes,
			);
			let bonus = anchorMatches * (mode === "strict" ? 0.85 : 1.15);
			bonus += metadataAnchorMatches * (queryKind === "path_like" ? 1.45 : 0.8);
			bonus += metadataCount * (queryKind === "path_like" ? 0.42 : 0.2);
			bonus +=
				Math.max(0, matchedCount - relaxedMinimumMatchCount) *
				(mode === "strict" ? 0.18 : 0.28);
			if (queryKind === "path_like" && metadataCount === 0) {
				bonus -= 0.45;
			}
			return bonus;
		},
	};
}

export function classifyFileSearchQuery(
	rawQueryText: string,
	queryTerms: string[],
): FileSearchQueryKind {
	const normalizedQuery = rawQueryText.trim();
	if (
		PATH_HINT_REGEX.test(normalizedQuery) ||
		EXTENSION_HINT_REGEX.test(normalizedQuery)
	) {
		return "path_like";
	}
	if (queryTerms.length <= 2 && normalizedQuery.length <= 18) {
		return "short_anchor";
	}
	if (queryTerms.length >= 5 || normalizedQuery.length >= 32) {
		return "sentence_like";
	}
	return "mixed";
}

function selectOptionalTermIndexes(
	matchedStats: FileSearchQueryTermStats[],
	docCount: number,
	queryKind: FileSearchQueryKind,
): Set<number> {
	const optionalIndexes = new Set<number>();
	if (matchedStats.length <= 3 || docCount <= 0) {
		return optionalIndexes;
	}

	const threshold =
		queryKind === "sentence_like"
			? 0.18
			: queryKind === "path_like"
				? 0.3
				: 0.24;

	for (const stat of matchedStats) {
		if (stat.matchedDocCount / docCount >= threshold) {
			optionalIndexes.add(stat.index);
		}
	}
	return optionalIndexes;
}

function selectAnchorTermIndexes(
	matchedStats: FileSearchQueryTermStats[],
	optionalTermIndexes: ReadonlySet<number>,
	queryKind: FileSearchQueryKind,
): Set<number> {
	const anchorCandidates = matchedStats
		.filter((stat) => !optionalTermIndexes.has(stat.index))
		.sort((left, right) => {
			const leftCoverage = getEffectiveCoverage(left, queryKind);
			const rightCoverage = getEffectiveCoverage(right, queryKind);
			if (leftCoverage !== rightCoverage) {
				return leftCoverage - rightCoverage;
			}
			if (left.hasExactMatch !== right.hasExactMatch) {
				return left.hasExactMatch ? -1 : 1;
			}
			if (left.queryTerm.length !== right.queryTerm.length) {
				return right.queryTerm.length - left.queryTerm.length;
			}
			return left.index - right.index;
		});

	const anchorCount = Math.min(2, anchorCandidates.length);
	return new Set(anchorCandidates.slice(0, anchorCount).map((stat) => stat.index));
}

function getEffectiveCoverage(
	stat: FileSearchQueryTermStats,
	queryKind: FileSearchQueryKind,
): number {
	if (queryKind === "path_like" && stat.matchedMetadataDocCount > 0) {
		return stat.matchedMetadataDocCount;
	}
	return stat.matchedDocCount;
}

function computeRelaxedMinimumMatchCount(
	queryKind: FileSearchQueryKind,
	anchorCount: number,
	effectiveRequiredTermCount: number,
	activeTermCount: number,
): number {
	if (activeTermCount <= 2 || queryKind === "short_anchor") {
		return activeTermCount;
	}
	if (queryKind === "path_like") {
		return effectiveRequiredTermCount;
	}
	const ratio = queryKind === "sentence_like" ? 0.6 : 0.7;
	return Math.min(
		activeTermCount,
		Math.max(anchorCount, Math.ceil(effectiveRequiredTermCount * ratio)),
	);
}

function countMatchedTermsExcluding(
	source: ReadonlySet<number>,
	excluded: ReadonlySet<number>,
): number {
	let count = 0;
	for (const value of source) {
		if (!excluded.has(value)) {
			count++;
		}
	}
	return count;
}

function countOverlap(
	left: ReadonlySet<number>,
	right: ReadonlySet<number>,
): number {
	let count = 0;
	for (const value of left) {
		if (right.has(value)) {
			count++;
		}
	}
	return count;
}
