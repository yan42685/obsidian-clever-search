import type {
	DirectSubitemsCandidateSpan,
	DirectSubitemsOccurrence,
	DirectSubitemsQueryTerm,
	DirectSubitemsRenderPayload,
} from "./contracts";
import {
	buildDirectSubitemsExactCandidateSpans,
	buildSupplementalCoverageSpans,
	type DirectSubitemsSpanOptions,
} from "./candidate-spans";
import { splitDirectSubitemsQueryTerms } from "./query-terms";
import {
	collectDirectSubitemsExactOccurrences,
	collectDirectSubitemsSupportOccurrences,
} from "./raw-occurrences";
import { renderDirectSubitemsCandidateSpans } from "./snippet-renderer";
import {
	dedupeDirectSubitemsCandidateSpans,
	rankDirectSubitemsCandidateSpans,
} from "./span-ranker";

export type DirectSubitemsExactBuildResult = {
	queryTerms: DirectSubitemsQueryTerm[];
	exactOccurrences: DirectSubitemsOccurrence[];
	candidateSpans: DirectSubitemsCandidateSpan[];
	renderPayloads: DirectSubitemsRenderPayload[];
};

export function buildDirectSubitemsExactCandidates(params: {
	queryText: string;
	snapshotText: string;
	options?: DirectSubitemsSpanOptions;
}): DirectSubitemsExactBuildResult {
	const queryTerms = splitDirectSubitemsQueryTerms(params.queryText);
	const exactOccurrences = collectDirectSubitemsExactOccurrences(
		params.snapshotText,
		queryTerms,
	);
	const supportOccurrences = collectDirectSubitemsSupportOccurrences(
		params.snapshotText,
		queryTerms,
	);
	const anchorOccurrences =
		exactOccurrences.length > 0 ? exactOccurrences : supportOccurrences;
	const initialSpans = buildDirectSubitemsExactCandidateSpans({
		snapshotText: params.snapshotText,
		queryTerms,
		anchorOccurrences,
		allOccurrences: [...exactOccurrences, ...supportOccurrences],
		options: params.options,
	});
	const deduped = dedupeDirectSubitemsCandidateSpans(initialSpans);
	const supplemental =
		exactOccurrences.length > 0
			? buildSupplementalCoverageSpans({
					snapshotText: params.snapshotText,
					queryTerms,
					exactOccurrences,
					existingSpans: deduped,
					options: params.options,
			  })
			: [];
	const finalized = finalizeSpans(
		params.snapshotText,
		rankDirectSubitemsCandidateSpans([
			...deduped,
			...supplemental,
		]),
		params.options,
	);
	return {
		queryTerms,
		exactOccurrences,
		candidateSpans: finalized.candidateSpans,
		renderPayloads: finalized.renderPayloads,
	};
}

export function buildDirectSubitemsExactFileSubItems(params: {
	queryText: string;
	snapshotText: string;
	options?: DirectSubitemsSpanOptions;
}): Array<{
	text: string;
	row: number;
	col: number;
	score?: number;
	snippetText?: string;
	highlightRanges?: Array<{ start: number; end: number }>;
	snippet: string;
}> {
	const { FileSubItem } = require("src/globals/search-types") as typeof import("src/globals/search-types");
	const result = buildDirectSubitemsExactCandidates(params);
	return result.renderPayloads.map((payload, index) => {
		const score = result.candidateSpans[index]?.score.coverageCount ?? 0;
		const subItem = new FileSubItem(
			payload.text,
			payload.row,
			payload.col,
			score,
			payload.html,
		);
		subItem.snippetText = payload.snippetText;
		subItem.highlightRanges = payload.highlightRanges.map((range) => ({
			start: range.start,
			end: range.end,
		}));
		return subItem;
	});
}

function finalizeSpans(
	snapshotText: string,
	candidateSpans: DirectSubitemsCandidateSpan[],
	options?: DirectSubitemsSpanOptions,
): {
	candidateSpans: DirectSubitemsCandidateSpan[];
	renderPayloads: DirectSubitemsRenderPayload[];
} {
	const renderPayloads = renderDirectSubitemsCandidateSpans({
		snapshotText,
		spans: candidateSpans,
		maxChars: options?.maxChars,
	});
	const selectedIndices = selectDisplayCandidateIndices(candidateSpans);
	return {
		candidateSpans: selectedIndices.map((index) => candidateSpans[index]),
		renderPayloads: selectedIndices.map((index) => renderPayloads[index]),
	};
}

const DISPLAY_OVERLAP_RATIO = 0.65;

function selectDisplayCandidateIndices(
	candidateSpans: readonly DirectSubitemsCandidateSpan[],
): number[] {
	const selectedIndices: number[] = [];
	for (let index = 0; index < candidateSpans.length; index++) {
		const overlappingIndices = selectedIndices.filter(
			(selectedIndex) =>
				computeRangeOverlapRatio(
					candidateSpans[selectedIndex],
					candidateSpans[index],
				) >= DISPLAY_OVERLAP_RATIO,
		);
		if (overlappingIndices.length === 0) {
			selectedIndices.push(index);
			continue;
		}
		if (
			hasNovelExactEvidence(
				candidateSpans[index],
				overlappingIndices.map((selectedIndex) => candidateSpans[selectedIndex]),
			)
		) {
			selectedIndices.push(index);
		}
	}
	return selectedIndices;
}

function hasNovelExactEvidence(
	candidateSpan: DirectSubitemsCandidateSpan,
	existingSpans: readonly DirectSubitemsCandidateSpan[],
): boolean {
	const existingExactKeys = new Set(
		existingSpans.flatMap((span) =>
			span.occurrences
				.filter((occurrence) => occurrence.tier === "exact")
				.map(buildOccurrenceKey),
		),
	);
	const candidateExactKeys = candidateSpan.occurrences
		.filter((occurrence) => occurrence.tier === "exact")
		.map(buildOccurrenceKey);
	if (candidateExactKeys.length === 0) {
		return false;
	}
	return candidateExactKeys.some((key) => !existingExactKeys.has(key));
}

function buildOccurrenceKey(occurrence: DirectSubitemsOccurrence): string {
	return `${occurrence.termId}:${occurrence.start}:${occurrence.end}:${occurrence.tier}`;
}

function computeRangeOverlapRatio(
	left: Pick<DirectSubitemsCandidateSpan, "start" | "end">,
	right: Pick<DirectSubitemsCandidateSpan, "start" | "end">,
): number {
	const overlapStart = Math.max(left.start, right.start);
	const overlapEnd = Math.min(left.end, right.end);
	if (overlapEnd <= overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart;
	const base = Math.max(1, Math.min(left.end - left.start, right.end - right.start));
	return overlap / base;
}