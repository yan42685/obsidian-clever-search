import { FileUtil } from "src/utils/file-util";
import {
	renderDirectSubitemsCandidateSpan,
	type DirectSubitemsCandidateSpan,
	type DirectSubitemsOccurrence,
} from "../../coverage-lexical/direct-subitems";
import {
	HYBRID_LEXICAL_LANE_DISPLAY_MAX_CHARS,
} from "./config";
import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneDisplayCandidate,
	HybridLexicalLaneMatchOccurrence,
	HybridLexicalLaneRankedBlockCandidate,
} from "./contracts";

export function buildHybridLexicalLaneDisplayCandidate(params: {
	snapshotText: string;
	candidate: HybridLexicalLaneBlockCandidate | HybridLexicalLaneRankedBlockCandidate;
	maxChars?: number;
}): HybridLexicalLaneDisplayCandidate {
	const { snapshotText, candidate } = params;
	const score =
		"scoreBreakdown" in candidate
			? candidate.scoreBreakdown.totalScore
			: candidate.localScore;
	if (candidate.bridgePreviewText) {
		const previewLength = candidate.bridgePreviewText.length;
		return {
			filePath: candidate.filePath,
			basename: FileUtil.getBasename(candidate.filePath),
			headingChain: [...candidate.headingChain],
			segmentText:
				candidate.bridgePreviewSegmentText ??
				(candidate.headingChain.join(" > ") || "metadata"),
			startLine: candidate.startLine,
			startCol: candidate.startCol,
			endLine: candidate.endLine,
			endCol: candidate.endCol,
			score,
			snippetText: candidate.bridgePreviewText,
			snippetHtml: candidate.bridgePreviewText,
			highlightRanges: candidate.bridgePreviewRanges?.map((range) => ({ ...range })) ?? [],
			coreStart: 0,
			coreEnd: previewLength,
			displayStart: 0,
			displayEnd: previewLength,
			anchorOffset: candidate.localSignals.anchorOffset,
		};
	}
	const payload = renderDirectSubitemsCandidateSpan({
		snapshotText,
		span: toDirectSubitemsCandidateSpan(candidate),
		maxChars: params.maxChars ?? HYBRID_LEXICAL_LANE_DISPLAY_MAX_CHARS,
	});
	return {
		filePath: candidate.filePath,
		basename: FileUtil.getBasename(candidate.filePath),
		headingChain: [...candidate.headingChain],
		segmentText: candidate.headingChain.join(" > "),
		startLine: candidate.startLine,
		startCol: candidate.startCol,
		endLine: candidate.endLine,
		endCol: candidate.endCol,
		score,
		snippetText: payload.snippetText,
		snippetHtml: payload.html,
		highlightRanges: payload.highlightRanges.map((range) => ({ ...range })),
		coreStart: payload.coreStart,
		coreEnd: payload.coreEnd,
		displayStart: payload.displayStart,
		displayEnd: payload.displayEnd,
		anchorOffset: payload.anchorOffset,
	};
}

export function buildHybridLexicalLaneDisplayCandidates(params: {
	candidates: readonly (
		| HybridLexicalLaneBlockCandidate
		| HybridLexicalLaneRankedBlockCandidate
	)[];
	snapshotTextByPath: ReadonlyMap<string, string>;
	maxChars?: number;
}): HybridLexicalLaneDisplayCandidate[] {
	return params.candidates
		.map((candidate) => {
			const snapshotText = params.snapshotTextByPath.get(candidate.filePath);
			if (!snapshotText) {
				return null;
			}
			return buildHybridLexicalLaneDisplayCandidate({
				snapshotText,
				candidate,
				maxChars: params.maxChars,
			});
		})
		.filter(
			(candidate): candidate is HybridLexicalLaneDisplayCandidate =>
				candidate !== null,
		);
}

function toDirectSubitemsCandidateSpan(
	candidate: HybridLexicalLaneBlockCandidate | HybridLexicalLaneRankedBlockCandidate,
): DirectSubitemsCandidateSpan {
	return {
		start: candidate.startOffset,
		end: candidate.endOffset,
		anchorOffset: candidate.localSignals.anchorOffset,
		occurrences: candidate.matchOccurrences.map(toDirectSubitemsOccurrence),
		termStats: [],
		termSignature: candidate.matchOccurrences
			.map((occurrence) => occurrence.termId)
			.sort((left, right) => left.localeCompare(right))
			.join("|"),
		score: {
			coverageCount: candidate.localSignals.coverageCount,
			exactCount: candidate.localSignals.exactCount,
			prefixCount: candidate.localSignals.prefixCount,
			fuzzyCount: candidate.localSignals.fuzzyCount,
			distancePenaltyTotal: candidate.localSignals.distancePenaltyTotal,
			distancePenaltyMax: candidate.localSignals.distancePenaltyMax,
			spanLength: candidate.localSignals.spanLength,
			anchorOffset: candidate.localSignals.anchorOffset,
		},
	};
}

function toDirectSubitemsOccurrence(
	occurrence: HybridLexicalLaneMatchOccurrence,
): DirectSubitemsOccurrence {
	return {
		termId: occurrence.termId,
		tier: occurrence.tier,
		start: occurrence.start,
		end: occurrence.end,
		distancePenalty: occurrence.distancePenalty,
	};
}
