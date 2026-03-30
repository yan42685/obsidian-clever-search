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
): {
	candidateSpans: DirectSubitemsCandidateSpan[];
	renderPayloads: DirectSubitemsRenderPayload[];
} {
	return {
		candidateSpans,
		renderPayloads: renderDirectSubitemsCandidateSpans({
			snapshotText,
			spans: candidateSpans,
		}),
	};
}
