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
	const structuralCandidates = buildStructuralCandidates({
		snapshotText: params.snapshotText,
		queryTerms,
		exactOccurrences,
		initialSpans,
		options: params.options,
	});
	const finalized = selectDisplayCandidates(
		params.snapshotText,
		structuralCandidates,
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

function buildStructuralCandidates(params: {
	snapshotText: string;
	queryTerms: readonly DirectSubitemsQueryTerm[];
	exactOccurrences: readonly DirectSubitemsOccurrence[];
	initialSpans: readonly DirectSubitemsCandidateSpan[];
	options?: DirectSubitemsSpanOptions;
}): DirectSubitemsCandidateSpan[] {
	const deduped = dedupeDirectSubitemsCandidateSpans(params.initialSpans);
	const supplemental =
		params.exactOccurrences.length > 0
			? buildSupplementalCoverageSpans({
					snapshotText: params.snapshotText,
					queryTerms: params.queryTerms,
					exactOccurrences: params.exactOccurrences,
					existingSpans: deduped,
					options: params.options,
			  })
			: [];
	return rankDirectSubitemsCandidateSpans([...deduped, ...supplemental]);
}

function selectDisplayCandidates(
	snapshotText: string,
	structuralCandidates: DirectSubitemsCandidateSpan[],
	options?: DirectSubitemsSpanOptions,
): {
	candidateSpans: DirectSubitemsCandidateSpan[];
	renderPayloads: DirectSubitemsRenderPayload[];
} {
	const renderPayloads = renderDirectSubitemsCandidateSpans({
		snapshotText,
		spans: structuralCandidates,
		maxChars: options?.maxChars,
	});
	const selectedIndices = selectDisplayRepresentativeIndices(
		structuralCandidates,
		renderPayloads,
	);
	return {
		candidateSpans: selectedIndices.map((index) => structuralCandidates[index]),
		renderPayloads: selectedIndices.map((index) => renderPayloads[index]),
	};
}

const DISPLAY_OVERLAP_RATIO = 0.65;

function selectDisplayRepresentativeIndices(
	structuralCandidates: readonly DirectSubitemsCandidateSpan[],
	renderPayloads: readonly DirectSubitemsRenderPayload[],
): number[] {
	const selectedIndices: number[] = [];
	for (let index = 0; index < structuralCandidates.length; index++) {
		const overlappingIndices = selectedIndices.filter(
			(selectedIndex) =>
				shouldCompressDisplayCandidate(
					structuralCandidates[selectedIndex],
					renderPayloads[selectedIndex],
					structuralCandidates[index],
					renderPayloads[index],
				),
		);
		if (overlappingIndices.length === 0) {
			selectedIndices.push(index);
			continue;
		}
		if (
			hasNovelDisplayEvidence(
				structuralCandidates[index],
				overlappingIndices.map((selectedIndex) => renderPayloads[selectedIndex]),
			)
		) {
			selectedIndices.push(index);
		}
	}
	return selectedIndices;
}

function shouldCompressDisplayCandidate(
	selectedSpan: DirectSubitemsCandidateSpan,
	selectedPayload: DirectSubitemsRenderPayload,
	candidateSpan: DirectSubitemsCandidateSpan,
	candidatePayload: DirectSubitemsRenderPayload,
): boolean {
	if (selectedSpan.termSignature !== candidateSpan.termSignature) {
		return false;
	}
	if (!selectedPayload.text.includes("\n") || !candidatePayload.text.includes("\n")) {
		return false;
	}
	if (Math.abs(selectedPayload.row - candidatePayload.row) > 1) {
		return false;
	}
	return (
		computeRangeOverlapRatio(
			{
				start: selectedPayload.displayStart,
				end: selectedPayload.displayEnd,
			},
			{
				start: candidatePayload.displayStart,
				end: candidatePayload.displayEnd,
			},
		) >= DISPLAY_OVERLAP_RATIO
	);
}

function hasNovelDisplayEvidence(
	candidateSpan: DirectSubitemsCandidateSpan,
	existingPayloads: readonly DirectSubitemsRenderPayload[],
): boolean {
	const exactOccurrences = candidateSpan.occurrences.filter(
		(occurrence) => occurrence.tier === "exact",
	);
	const coverageOccurrences =
		exactOccurrences.length > 0 ? exactOccurrences : candidateSpan.occurrences;
	if (coverageOccurrences.length === 0) {
		return false;
	}
	return coverageOccurrences.some(
		(occurrence) => !isOccurrenceVisibleInPayloads(occurrence, existingPayloads),
	);
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

function isOccurrenceVisibleInPayloads(
	occurrence: DirectSubitemsOccurrence,
	payloads: readonly DirectSubitemsRenderPayload[],
): boolean {
	return payloads.some(
		(payload) =>
			occurrence.start >= payload.displayStart && occurrence.end <= payload.displayEnd,
	);
}
