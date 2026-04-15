import { FileSubItem } from "src/globals/search-types";
import type {
	V3DirectSubitemsBuildParams,
	V3DirectSubitemsBuildResult,
} from "./contracts";
import { buildV3DirectSubitemCandidates } from "./evidence";
import { compareV3DirectSubitemCandidates } from "./ranker";
import { renderV3DirectSubitemCandidate } from "./renderer";

export function buildV3DirectSubitems(
	params: V3DirectSubitemsBuildParams,
): V3DirectSubitemsBuildResult {
	const candidates = buildV3DirectSubitemCandidates({
		snapshotText: params.snapshotText,
		queryAnalysis: params.queryAnalysis,
		candidate: params.candidate,
		candidateRecall: params.candidateRecall,
		residentBase: params.residentBase,
		candidateRangeMode: params.candidateRangeMode,
	}).sort(compareV3DirectSubitemCandidates);
	const limitedCandidates = candidates.slice(
		0,
		Math.max(1, params.maxSubItemResults ?? 5),
	);
	const renderPayloads = limitedCandidates.map((candidate) =>
		renderV3DirectSubitemCandidate({
			snapshotText: params.snapshotText,
			candidate,
		}),
	);
	const subItems = renderPayloads.map((payload, index) => {
		const candidate = limitedCandidates[index];
		const subItem = new FileSubItem(
			payload.text,
			payload.row,
			payload.col,
			candidate.coveredRealPrimaryCount,
			payload.html,
		);
		subItem.snippetText = payload.snippetText;
		subItem.highlightRanges = payload.highlightRanges.map((range) => ({
			start: range.start,
			end: range.end,
		}));
		return subItem;
	});
	return {
		candidates: limitedCandidates,
		renderPayloads,
		subItems,
	};
}
