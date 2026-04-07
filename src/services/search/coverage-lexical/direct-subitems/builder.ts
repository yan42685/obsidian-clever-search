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

export type DirectSubitemsSupportStrategy =
	| "always"
	| "skip_if_exact_term_coverage";

export function buildDirectSubitemsExactCandidates(params: {
	queryText: string;
	snapshotText: string;
	options?: DirectSubitemsSpanOptions;
	supportStrategy?: DirectSubitemsSupportStrategy;
}): DirectSubitemsExactBuildResult {
	const queryTerms = splitDirectSubitemsQueryTerms(params.queryText);
	const exactOccurrences = collectDirectSubitemsExactOccurrences(
		params.snapshotText,
		queryTerms,
	);
	const supportStrategy = params.supportStrategy ?? "always";
	const supportOccurrences = shouldCollectSupportOccurrences(
		queryTerms,
		exactOccurrences,
		supportStrategy,
	)
		? collectDirectSubitemsSupportOccurrences(params.snapshotText, queryTerms)
		: [];
	const anchorOccurrences =
		exactOccurrences.length > 0 ? exactOccurrences : supportOccurrences;
	const initialSpans = buildDirectSubitemsExactCandidateSpans({
		queryText: params.queryText,
		snapshotText: params.snapshotText,
		queryTerms,
		anchorOccurrences,
		allOccurrences: [...exactOccurrences, ...supportOccurrences],
		options: params.options,
	});
	const structuralCandidates = buildStructuralCandidates({
		queryText: params.queryText,
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

function shouldCollectSupportOccurrences(
	queryTerms: readonly DirectSubitemsQueryTerm[],
	exactOccurrences: readonly DirectSubitemsOccurrence[],
	supportStrategy: DirectSubitemsSupportStrategy,
): boolean {
	if (supportStrategy === "always") {
		return true;
	}
	if (queryTerms.length === 0) {
		return false;
	}
	const exactTermIds = new Set(
		exactOccurrences.map((occurrence) => occurrence.termId),
	);
	return queryTerms.some((term) => !exactTermIds.has(term.termId));
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
	queryText: string;
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
					queryText: params.queryText,
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
	);
	return {
		candidateSpans: selectedIndices.map((index) => structuralCandidates[index]),
		renderPayloads: selectedIndices.map((index) => renderPayloads[index]),
	};
}

function selectDisplayRepresentativeIndices(
	structuralCandidates: readonly DirectSubitemsCandidateSpan[],
): number[] {
	const topCoverageCount = structuralCandidates[0]?.score.coverageCount ?? 0;
	const selectedIndices: number[] = [];
	for (let index = 0; index < structuralCandidates.length; index++) {
		if (
			!shouldHideWeakDisplayCandidate(
				structuralCandidates[index],
				selectedIndices.map((selectedIndex) => structuralCandidates[selectedIndex]),
				topCoverageCount,
			)
		) {
			selectedIndices.push(index);
		}
	}
	return selectedIndices;
}

function shouldHideWeakDisplayCandidate(
	candidateSpan: DirectSubitemsCandidateSpan,
	selectedSpans: readonly DirectSubitemsCandidateSpan[],
	topCoverageCount: number,
): boolean {
	if (selectedSpans.length === 0 || topCoverageCount <= 0) {
		return false;
	}
	if (candidateSpan.score.coverageCount > topCoverageCount * 0.5) {
		return false;
	}
	return !hasNovelExactEvidence(candidateSpan, selectedSpans);
}

function hasNovelExactEvidence(
	candidateSpan: DirectSubitemsCandidateSpan,
	selectedSpans: readonly DirectSubitemsCandidateSpan[],
): boolean {
	const candidateExactTermIds = new Set(
		candidateSpan.occurrences
			.filter((occurrence) => occurrence.tier === "exact")
			.map((occurrence) => occurrence.termId),
	);
	if (candidateExactTermIds.size === 0) {
		return false;
	}
	const selectedExactTermIds = new Set(
		selectedSpans.flatMap((span) =>
			span.occurrences
				.filter((occurrence) => occurrence.tier === "exact")
				.map((occurrence) => occurrence.termId),
		),
	);
	return [...candidateExactTermIds].some(
		(termId) => !selectedExactTermIds.has(termId),
	);
}