import { FileUtil } from "src/utils/file-util";
import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneDisplayCandidate,
	HybridLexicalLaneRankedBlockCandidate,
} from "./contracts";
import { buildHybridSharedSnippet } from "../shared-snippet/build-shared-snippet";

export function buildHybridLexicalLaneDisplayCandidate(params: {
	snapshotText: string;
	candidate: HybridLexicalLaneBlockCandidate | HybridLexicalLaneRankedBlockCandidate;
}): HybridLexicalLaneDisplayCandidate {
	const { snapshotText, candidate } = params;
	const score =
		"scoreBreakdown" in candidate
			? candidate.scoreBreakdown.totalScore
			: candidate.localScore;
	if (candidate.bridgePreviewText) {
		const payload = buildHybridSharedSnippet({
			snapshotText,
			candidate,
		});
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
			snippetText: payload.snippetText,
			snippetHtml: payload.snippetHtml,
			headerText: payload.headerText,
			bodyText: payload.bodyText,
			highlightRanges: payload.highlightRanges,
			bodyHighlightRanges: payload.bodyHighlightRanges,
			coreStart: payload.coreStart,
			coreEnd: payload.coreEnd,
			displayStart: payload.displayStart,
			displayEnd: payload.displayEnd,
			bodyStart: payload.bodyStart,
			bodyEnd: payload.bodyEnd,
			anchorOffset: payload.anchorOffset,
		};
	}
	const payload = buildHybridSharedSnippet({
		snapshotText,
		candidate,
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
		snippetHtml: payload.snippetHtml,
		headerText: payload.headerText,
		bodyText: payload.bodyText,
		highlightRanges: payload.highlightRanges,
		bodyHighlightRanges: payload.bodyHighlightRanges,
		coreStart: payload.coreStart,
		coreEnd: payload.coreEnd,
		displayStart: payload.displayStart,
		displayEnd: payload.displayEnd,
		bodyStart: payload.bodyStart,
		bodyEnd: payload.bodyEnd,
		anchorOffset: payload.anchorOffset,
	};
}

export function buildHybridLexicalLaneDisplayCandidates(params: {
	candidates: readonly (
		| HybridLexicalLaneBlockCandidate
		| HybridLexicalLaneRankedBlockCandidate
	)[];
	snapshotTextByPath: ReadonlyMap<string, string>;
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
			});
		})
		.filter(
			(candidate): candidate is HybridLexicalLaneDisplayCandidate =>
				candidate !== null,
		);
}
