import type {
	DirectSubitemsCandidateSpan,
	DirectSubitemsOccurrence,
	DirectSubitemsQueryTerm,
	DirectSubitemsSpanTermStat,
} from "./contracts";
import { compareOccurrences } from "./raw-occurrences";

export type DirectSubitemsSpanOptions = {
	maxChars?: number;
	mergeGap?: number;
	contextLeft?: number;
	contextRight?: number;
	boundaryLookaround?: number;
};

const DEFAULT_MAX_CHARS = 200;
const DEFAULT_MERGE_GAP = 32;
const DEFAULT_CONTEXT_LEFT = 24;
const DEFAULT_CONTEXT_RIGHT = 40;
const DEFAULT_BOUNDARY_LOOKAROUND = 24;

export function buildDirectSubitemsExactCandidateSpans(params: {
	snapshotText: string;
	queryTerms: readonly DirectSubitemsQueryTerm[];
	anchorOccurrences: readonly DirectSubitemsOccurrence[];
	allOccurrences?: readonly DirectSubitemsOccurrence[];
	options?: DirectSubitemsSpanOptions;
}): DirectSubitemsCandidateSpan[] {
	const occurrences = [...params.anchorOccurrences].sort(compareOccurrences);
	if (occurrences.length === 0) {
		return [];
	}
	const allOccurrences = [...(params.allOccurrences ?? params.anchorOccurrences)].sort(
		compareOccurrences,
	);
	const options = resolveSpanOptions(params.options);
	const spans: DirectSubitemsCandidateSpan[] = [];
	let index = 0;
	while (index < occurrences.length) {
		const group: DirectSubitemsOccurrence[] = [occurrences[index]];
		let groupCoverStart = occurrences[index].start;
		let groupCoverEnd = occurrences[index].end;
		let nextIndex = index + 1;
		while (nextIndex < occurrences.length) {
			const next = occurrences[nextIndex];
			const gap = Math.max(0, next.start - groupCoverEnd);
			const projectedCoverStart = Math.min(groupCoverStart, next.start);
			const projectedCoverEnd = Math.max(groupCoverEnd, next.end);
			const projectedRenderLength =
				projectedCoverEnd -
				projectedCoverStart +
				options.contextLeft +
				options.contextRight;
			if (gap > options.mergeGap || projectedRenderLength > options.maxChars) {
				break;
			}
			group.push(next);
			groupCoverStart = projectedCoverStart;
			groupCoverEnd = projectedCoverEnd;
			nextIndex += 1;
		}
		spans.push(
			buildCandidateSpanFromGroup(
				params.snapshotText,
				params.queryTerms,
				group,
				allOccurrences,
				options,
			),
		);
		index = nextIndex;
	}
	return spans;
}

export function buildSupplementalCoverageSpans(params: {
	snapshotText: string;
	queryTerms: readonly DirectSubitemsQueryTerm[];
	exactOccurrences: readonly DirectSubitemsOccurrence[];
	existingSpans: readonly DirectSubitemsCandidateSpan[];
	options?: DirectSubitemsSpanOptions;
}): DirectSubitemsCandidateSpan[] {
	const options = resolveSpanOptions(params.options);
	const existingKeys = new Set(
		params.existingSpans.flatMap((span) => span.occurrences.map(buildOccurrenceKey)),
	);
	const supplemental: DirectSubitemsCandidateSpan[] = [];
	for (const occurrence of params.exactOccurrences) {
		if (existingKeys.has(buildOccurrenceKey(occurrence))) {
			continue;
		}
		supplemental.push(
			buildCandidateSpanFromGroup(
				params.snapshotText,
				params.queryTerms,
				[occurrence],
				params.exactOccurrences,
				options,
			),
		);
	}
	return supplemental;
}

function buildCandidateSpanFromGroup(
	snapshotText: string,
	queryTerms: readonly DirectSubitemsQueryTerm[],
	group: readonly DirectSubitemsOccurrence[],
	allOccurrences: readonly DirectSubitemsOccurrence[],
	options: Required<DirectSubitemsSpanOptions>,
): DirectSubitemsCandidateSpan {
	const expandedCover = expandCoverWithSupportingOccurrences(
		group,
		allOccurrences,
		options,
	);
	const coverStart = expandedCover.start;
	const coverEnd = expandedCover.end;
	const initialStart = Math.max(0, coverStart - options.contextLeft);
	const initialEnd = Math.min(snapshotText.length, coverEnd + options.contextRight);
	const start = trimLeftBoundary(
		snapshotText,
		initialStart,
		coverStart,
		options.boundaryLookaround,
	);
	const end = trimRightBoundary(
		snapshotText,
		initialEnd,
		coverEnd,
		options.boundaryLookaround,
	);
	const renderOccurrences = allOccurrences
		.filter((occurrence) => occurrence.start >= start && occurrence.end <= end)
		.sort(compareOccurrences);
	const termStats = buildSpanTermStats(queryTerms, renderOccurrences);
	const rankedOccurrences = pickRepresentativeOccurrences(renderOccurrences);
	const anchorOccurrence = pickAnchorOccurrence(renderOccurrences);
	const anchorOffset = anchorOccurrence?.start ?? start;
	return {
		start,
		end,
		anchorOffset,
		occurrences: renderOccurrences,
		termStats,
		termSignature: buildTermSignature(termStats),
		score: buildSpanScore(start, end, anchorOffset, rankedOccurrences, termStats),
	};
}

function buildSpanTermStats(
	queryTerms: readonly DirectSubitemsQueryTerm[],
	occurrences: readonly DirectSubitemsOccurrence[],
): DirectSubitemsSpanTermStat[] {
	const bestTierByTerm = new Map<string, DirectSubitemsSpanTermStat>();
	for (const term of queryTerms) {
		bestTierByTerm.set(term.termId, {
			termId: term.termId,
			bestTier: "miss",
			bestDistancePenalty: 0,
		});
	}
	for (const occurrence of occurrences) {
		const current = bestTierByTerm.get(occurrence.termId);
		if (
			current &&
			compareMatchTier(current.bestTier, occurrence.tier) <= 0 &&
			!(current.bestTier === occurrence.tier && occurrence.distancePenalty < current.bestDistancePenalty)
		) {
			continue;
		}
		bestTierByTerm.set(occurrence.termId, {
			termId: occurrence.termId,
			bestTier: occurrence.tier,
			bestDistancePenalty: occurrence.distancePenalty,
		});
	}
	return [...bestTierByTerm.values()].sort((left, right) =>
		left.termId.localeCompare(right.termId),
	);
}

function buildTermSignature(termStats: readonly DirectSubitemsSpanTermStat[]): string {
	return termStats
		.filter((termStat) => termStat.bestTier !== "miss")
		.map((termStat) => `${termStat.termId}:${termStat.bestTier}`)
		.join("|");
}

function pickRepresentativeOccurrences(
	occurrences: readonly DirectSubitemsOccurrence[],
): DirectSubitemsOccurrence[] {
	const bestByTerm = new Map<string, DirectSubitemsOccurrence>();
	for (const occurrence of occurrences) {
		const existing = bestByTerm.get(occurrence.termId);
		if (
			!existing ||
			compareMatchTier(existing.tier, occurrence.tier) > 0 ||
			(existing.tier === occurrence.tier &&
				(occurrence.distancePenalty < existing.distancePenalty ||
					(occurrence.distancePenalty === existing.distancePenalty &&
						occurrence.start < existing.start)))
		) {
			bestByTerm.set(occurrence.termId, occurrence);
		}
	}
	return [...bestByTerm.values()].sort(compareOccurrences);
}

function pickAnchorOccurrence(
	occurrences: readonly DirectSubitemsOccurrence[],
): DirectSubitemsOccurrence | null {
	if (occurrences.length === 0) {
		return null;
	}
	let best = occurrences[0];
	for (const occurrence of occurrences.slice(1)) {
		if (compareAnchorOccurrences(occurrence, best) < 0) {
			best = occurrence;
		}
	}
	return best;
}

function compareAnchorOccurrences(
	left: DirectSubitemsOccurrence,
	right: DirectSubitemsOccurrence,
): number {
	const tierDelta = compareMatchTier(left.tier, right.tier);
	if (tierDelta !== 0) {
		return tierDelta;
	}
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	if (left.distancePenalty !== right.distancePenalty) {
		return left.distancePenalty - right.distancePenalty;
	}
	if (left.end !== right.end) {
		return left.end - right.end;
	}
	return left.termId.localeCompare(right.termId);
}

function buildSpanScore(
	start: number,
	end: number,
	anchorOffset: number,
	occurrences: readonly DirectSubitemsOccurrence[],
	termStats: readonly DirectSubitemsSpanTermStat[],
): DirectSubitemsCandidateSpan["score"] {
	const exactCount = termStats.filter((termStat) => termStat.bestTier === "exact").length;
	const prefixCount = termStats.filter((termStat) => termStat.bestTier === "prefix").length;
	const fuzzyCount = termStats.filter((termStat) => termStat.bestTier === "fuzzy").length;
	const coverageCount = exactCount + prefixCount + fuzzyCount;
	let distancePenaltyTotal = 0;
	let distancePenaltyMax = 0;
	for (let index = 1; index < occurrences.length; index++) {
		const gap = Math.max(0, occurrences[index].start - occurrences[index - 1].end);
		distancePenaltyTotal += gap;
		distancePenaltyMax = Math.max(distancePenaltyMax, gap);
	}
	return {
		coverageCount,
		exactCount,
		prefixCount,
		fuzzyCount,
		distancePenaltyTotal,
		distancePenaltyMax,
		spanLength: Math.max(1, end - start),
		anchorOffset,
	};
}

function trimLeftBoundary(
	text: string,
	start: number,
	coverStart: number,
	lookaround: number,
): number {
	const floor = Math.max(0, coverStart - lookaround);
	for (let index = coverStart - 1; index >= floor; index--) {
		if (isSoftBoundary(text[index])) {
			return Math.max(start, index + 1);
		}
	}
	return start;
}

function trimRightBoundary(
	text: string,
	end: number,
	coverEnd: number,
	lookaround: number,
): number {
	const ceiling = Math.min(text.length, coverEnd + lookaround);
	for (let index = coverEnd; index < ceiling; index++) {
		if (isSoftBoundary(text[index])) {
			return Math.min(end, index);
		}
	}
	return end;
}

function isSoftBoundary(char: string | undefined): boolean {
	return !!char && /[\r\n\t .,;:!?()[\]{}<>|/\\，。；：！？（）【】《》、]/u.test(char);
}

function resolveSpanOptions(
	options: DirectSubitemsSpanOptions | undefined,
): Required<DirectSubitemsSpanOptions> {
	return {
		maxChars: options?.maxChars ?? DEFAULT_MAX_CHARS,
		mergeGap: options?.mergeGap ?? DEFAULT_MERGE_GAP,
		contextLeft: options?.contextLeft ?? DEFAULT_CONTEXT_LEFT,
		contextRight: options?.contextRight ?? DEFAULT_CONTEXT_RIGHT,
		boundaryLookaround: options?.boundaryLookaround ?? DEFAULT_BOUNDARY_LOOKAROUND,
	};
}

function buildOccurrenceKey(occurrence: DirectSubitemsOccurrence): string {
	return `${occurrence.termId}:${occurrence.start}:${occurrence.end}:${occurrence.tier}`;
}

function compareMatchTier(
	left: DirectSubitemsSpanTermStat["bestTier"],
	right: DirectSubitemsOccurrence["tier"],
): number {
	const rank = {
		exact: 0,
		prefix: 1,
		fuzzy: 2,
		miss: 3,
	} as const;
	return rank[left] - rank[right];
}

function expandCoverWithSupportingOccurrences(
	group: readonly DirectSubitemsOccurrence[],
	allOccurrences: readonly DirectSubitemsOccurrence[],
	options: Required<DirectSubitemsSpanOptions>,
): { start: number; end: number } {
	const groupKeys = new Set(
		group.map(
			(occurrence) =>
				`${occurrence.termId}:${occurrence.start}:${occurrence.end}:${occurrence.tier}`,
		),
	);
	let coverStart = Math.min(...group.map((occurrence) => occurrence.start));
	let coverEnd = Math.max(...group.map((occurrence) => occurrence.end));
	let changed = true;
	while (changed) {
		changed = false;
		for (const occurrence of allOccurrences) {
			const occurrenceKey = `${occurrence.termId}:${occurrence.start}:${occurrence.end}:${occurrence.tier}`;
			if (occurrence.tier === "exact" && !groupKeys.has(occurrenceKey)) {
				continue;
			}
			if (occurrence.start >= coverStart && occurrence.end <= coverEnd) {
				continue;
			}
			const gap =
				occurrence.end < coverStart
					? coverStart - occurrence.end
					: occurrence.start > coverEnd
						? occurrence.start - coverEnd
						: 0;
			if (gap > options.mergeGap) {
				continue;
			}
			const projectedStart = Math.min(coverStart, occurrence.start);
			const projectedEnd = Math.max(coverEnd, occurrence.end);
			const projectedRenderLength =
				projectedEnd -
				projectedStart +
				options.contextLeft +
				options.contextRight;
			if (projectedRenderLength > options.maxChars) {
				continue;
			}
			coverStart = projectedStart;
			coverEnd = projectedEnd;
			changed = true;
		}
	}
	return { start: coverStart, end: coverEnd };
}
