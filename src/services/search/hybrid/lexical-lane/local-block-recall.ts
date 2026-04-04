import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import { FileUtil } from "src/utils/file-util";
import {
	buildDirectSubitemsExactCandidates,
	type DirectSubitemsCandidateSpan,
	type DirectSubitemsMatchTier,
	type DirectSubitemsQueryTerm,
	type DirectSubitemsRenderPayload,
	splitDirectSubitemsQueryTerms,
} from "../../coverage-lexical/direct-subitems";
import {
	buildLineOffsets,
	offsetToLine,
	parseTextHeadingOutline,
} from "../chunker";
import { getInstance } from "src/utils/my-lib";
import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneFileCandidate,
} from "./contracts";

const HYBRID_LEXICAL_LANE_SEED_SPAN_OPTIONS = {
	mergeGap: 32,
	contextLeft: 24,
	contextRight: 40,
	boundaryLookaround: 24,
} as const;

export async function buildHybridLexicalLaneLocalBlockCandidates(params: {
	queryText: string;
	files: readonly HybridLexicalLaneFileCandidate[];
	maxBlocksPerFile: number;
}): Promise<{
	blockCandidates: HybridLexicalLaneBlockCandidate[];
	snapshotTextByPath: Map<string, string>;
}> {
	const dataProvider = getInstance(DataProvider);
	const blockCandidates: HybridLexicalLaneBlockCandidate[] = [];
	const snapshotTextByPath = new Map<string, string>();

	for (const file of params.files) {
		const snapshotText = await dataProvider.readPlainText(file.filePath);
		if (!snapshotText.trim()) {
			continue;
		}
		snapshotTextByPath.set(file.filePath, snapshotText);
		const headingOutline = dataProvider.getHeadingOutlineForText(file.filePath, snapshotText);
		blockCandidates.push(
			...buildHybridLexicalLaneBlockCandidatesForSnapshot({
				queryText: params.queryText,
				file,
				snapshotText,
				headingOutline,
				maxBlocksPerFile: resolvePerFileBlockLimit(
					file,
					params.maxBlocksPerFile,
				),
			}),
		);
	}

	return {
		blockCandidates,
		snapshotTextByPath,
	};
}

function resolvePerFileBlockLimit(
	file: Pick<
		HybridLexicalLaneFileCandidate,
		"fileRank" | "metadataSignals"
	>,
	baseLimit: number,
): number {
	if (baseLimit <= 0) {
		return 0;
	}
	const metadataBonusEligible =
		file.metadataSignals.aliasTokenCoverageCount >= 2 ||
		file.metadataSignals.aliasContainedInQueryCount > 0 ||
		file.metadataSignals.basenameTokenCoverageCount >= 2 ||
		file.metadataSignals.basenameContainedInQuery;
	if (file.fileRank <= 0) {
		return baseLimit + 4 + (metadataBonusEligible ? 2 : 0);
	}
	if (file.fileRank === 1) {
		return baseLimit + 2 + (metadataBonusEligible ? 2 : 0);
	}
	if (file.fileRank === 2 && metadataBonusEligible) {
		return baseLimit + 1;
	}
	return baseLimit;
}

export function buildHybridLexicalLaneBlockCandidatesForSnapshot(params: {
	queryText: string;
	file: HybridLexicalLaneFileCandidate;
	snapshotText: string;
	headingOutline?: Array<{ line: number; level: number; title: string }>;
	maxBlocksPerFile: number;
}): HybridLexicalLaneBlockCandidate[] {
	if (!params.snapshotText.trim()) {
		return [];
	}
	const headingOutline =
		params.headingOutline ?? parseTextHeadingOutline(params.snapshotText);
	const headingChainByLine = buildHeadingChainsByLine(
		params.snapshotText.split("\n").length,
		headingOutline,
	);
	const directSubitems = buildDirectSubitemsExactCandidates({
		queryText: params.queryText,
		snapshotText: params.snapshotText,
		// This only seeds local lexical spans; final display/rerank text comes from
		// the shared snippet builder, so we no longer plumb the old 220-char display
		// budget through this path.
		options: HYBRID_LEXICAL_LANE_SEED_SPAN_OPTIONS,
	});
	const lineOffsets = buildLineOffsets(params.snapshotText);
	const limit = Math.max(0, params.maxBlocksPerFile);
	const candidates: HybridLexicalLaneBlockCandidate[] = [];
	const queryTerms = splitDirectSubitemsQueryTerms(params.queryText);
	for (
		let index = 0;
		index < directSubitems.candidateSpans.length && index < limit;
		index++
	) {
		const span = directSubitems.candidateSpans[index];
		const payload = directSubitems.renderPayloads[index];
		if (!span || !payload) {
			continue;
		}
		candidates.push(
			createBlockCandidate({
				file: params.file,
				span,
				payload,
				lineOffsets,
				headingChainByLine,
				snapshotText: params.snapshotText,
			}),
		);
	}
	const metadataBridgeCandidate = createMetadataBridgeCandidate({
		queryTerms,
		file: params.file,
		snapshotText: params.snapshotText,
		lineOffsets,
		headingOutline,
		headingChainByLine,
	});
	if (metadataBridgeCandidate !== null) {
		candidates.push(metadataBridgeCandidate);
	}
	const focusedHeadingBridgeCandidate =
		metadataBridgeCandidate === null
			? createFocusedHeadingBridgeCandidate({
					queryTerms,
					file: params.file,
					snapshotText: params.snapshotText,
					lineOffsets,
					headingOutline,
					headingChainByLine,
			  })
			: null;
	if (focusedHeadingBridgeCandidate !== null) {
		candidates.push(focusedHeadingBridgeCandidate);
	}
	const fileRecallBridgeCandidate = createFileRecallBridgeCandidate({
		queryTerms,
		file: params.file,
		snapshotText: params.snapshotText,
		lineOffsets,
		headingChainByLine,
	});
	if (fileRecallBridgeCandidate !== null) {
		candidates.push(fileRecallBridgeCandidate);
	}
	return candidates;
}

function createBlockCandidate(params: {
	file: HybridLexicalLaneFileCandidate;
	span: DirectSubitemsCandidateSpan;
	payload: DirectSubitemsRenderPayload;
	lineOffsets: number[];
	headingChainByLine: string[][];
	snapshotText: string;
}): HybridLexicalLaneBlockCandidate {
	const { file, span, payload, lineOffsets, headingChainByLine, snapshotText } = params;
	const startLine = payload.row;
	const endLine = offsetToLine(
		lineOffsets,
		Math.max(span.start, span.end - 1),
	);
	const endLineOffset = lineOffsets[endLine] ?? 0;
	return {
		filePath: file.filePath,
		blockId: `${file.filePath}#${span.start}-${span.end}`,
		startOffset: span.start,
		endOffset: span.end,
		startLine,
		startCol: payload.col,
		endLine,
		endCol: Math.max(0, span.end - endLineOffset),
		text: snapshotText.slice(span.start, span.end),
		headingChain: [...(headingChainByLine[startLine] ?? [])],
		parentFileScore: file.fileScore,
		parentFileRank: file.fileRank,
		parentMetadataSignals: { ...file.metadataSignals },
		localScore: computeLocalScore(span),
		localSignals: {
			coverageCount: span.score.coverageCount,
			exactCount: span.score.exactCount,
			prefixCount: span.score.prefixCount,
			fuzzyCount: span.score.fuzzyCount,
			queryTermCount: span.termStats.length,
			missCount: span.termStats.filter((termStat) => termStat.bestTier === "miss")
				.length,
			occurrenceCount: span.occurrences.length,
			occurrenceSpread: computeOccurrenceSpread(span),
			distancePenaltyTotal: span.score.distancePenaltyTotal,
			distancePenaltyMax: span.score.distancePenaltyMax,
			spanLength: span.score.spanLength,
			anchorOffset: span.score.anchorOffset,
		},
		termStats: span.termStats.map((termStat) => ({
			termId: termStat.termId,
			bestTier: termStat.bestTier,
			bestDistancePenalty: termStat.bestDistancePenalty,
		})),
		matchOccurrences: span.occurrences.map((occurrence) => ({
			termId: occurrence.termId,
			tier: occurrence.tier,
			start: occurrence.start,
			end: occurrence.end,
			distancePenalty: occurrence.distancePenalty,
		})),
	};
}

function computeLocalScore(span: DirectSubitemsCandidateSpan): number {
	const queryTermCount = Math.max(1, span.termStats.length);
	const missCount = span.termStats.filter((termStat) => termStat.bestTier === "miss")
		.length;
	const coverageRatio = span.score.coverageCount / queryTermCount;
	const occurrenceSpread = computeOccurrenceSpread(span);
	const compactnessBonus = Math.max(
		0,
		180 - Math.min(span.score.spanLength, occurrenceSpread || span.score.spanLength),
	);
	return (
		coverageRatio * 120 +
		span.score.exactCount * 28 +
		span.score.prefixCount * 12 +
		span.score.fuzzyCount * 4 -
		missCount * 18 -
		span.score.distancePenaltyTotal * 0.9 -
		span.score.distancePenaltyMax * 1.4 +
		compactnessBonus * 0.18
	);
}

function computeOccurrenceSpread(span: Pick<DirectSubitemsCandidateSpan, "occurrences">): number {
	if (span.occurrences.length <= 1) {
		return 0;
	}
	const first = span.occurrences[0];
	const last = span.occurrences[span.occurrences.length - 1];
	return Math.max(0, last.end - first.start);
}

function createMetadataBridgeCandidate(params: {
	queryTerms: readonly DirectSubitemsQueryTerm[];
	file: HybridLexicalLaneFileCandidate;
	snapshotText: string;
	lineOffsets: number[];
	headingOutline: Array<{ line: number; level: number; title: string }>;
	headingChainByLine: string[][];
}): HybridLexicalLaneBlockCandidate | null {
	if (params.queryTerms.length === 0) {
		return null;
	}
	const metadataEntries = buildMetadataBridgeEntries(
		params.file,
		params.headingOutline,
	);
	const metadataTexts = metadataEntries.map((entry) => entry.text);
	const termStats = params.queryTerms.map((term) => ({
		termId: term.termId,
		bestTier: classifyMetadataTermMatch(term, metadataTexts),
		bestDistancePenalty: 0,
	}));
	const exactCount = termStats.filter((termStat) => termStat.bestTier === "exact").length;
	const prefixCount = termStats.filter(
		(termStat) => termStat.bestTier === "prefix",
	).length;
	const coverageCount = termStats.filter(
		(termStat) => termStat.bestTier !== "miss",
	).length;
	if (
		coverageCount === 0 ||
		!(
			params.file.metadataSignals.basenameExact ||
			params.file.metadataSignals.basenamePrefix ||
			params.file.metadataSignals.pathExact ||
			params.file.metadataSignals.pathPrefix ||
			params.file.metadataSignals.headingMetaHit ||
			params.file.metadataSignals.aliasHit
		)
	) {
		return null;
	}
	const metadataPreview = buildMetadataBridgePreview(
		params.queryTerms,
		metadataEntries,
	);
	if (metadataPreview === null) {
		return null;
	}

	const anchorOffset = resolveMetadataAnchorOffset(
		params.queryTerms,
		params.snapshotText,
		params.headingOutline,
		params.lineOffsets,
	);
	const endOffset = Math.min(
		params.snapshotText.length,
		Math.max(anchorOffset + 1, anchorOffset + 220),
	);
	const startLine = offsetToLine(params.lineOffsets, anchorOffset);
	const endLine = offsetToLine(
		params.lineOffsets,
		Math.max(anchorOffset, endOffset - 1),
	);
	const startLineOffset = params.lineOffsets[startLine] ?? 0;
	const endLineOffset = params.lineOffsets[endLine] ?? 0;
	const matchOccurrences = collectBridgeMatchOccurrences({
		queryTerms: params.queryTerms,
		previewText: metadataPreview.text,
		anchorOffset,
		maxSpanLength: Math.max(1, endOffset - anchorOffset),
	});
	const missCount = termStats.length - coverageCount;

	return {
		filePath: params.file.filePath,
		blockId: `${params.file.filePath}#metadata-bridge-${anchorOffset}-${endOffset}`,
		startOffset: anchorOffset,
		endOffset,
		startLine,
		startCol: Math.max(0, anchorOffset - startLineOffset),
		endLine,
		endCol: Math.max(0, endOffset - endLineOffset),
		text: params.snapshotText.slice(anchorOffset, endOffset),
		headingChain: [...(params.headingChainByLine[startLine] ?? [])],
		parentFileScore: params.file.fileScore,
		parentFileRank: params.file.fileRank,
		parentMetadataSignals: { ...params.file.metadataSignals },
		localScore:
			coverageCount * 54 +
			exactCount * 32 +
			prefixCount * 16 +
			params.file.metadataSignals.headingExactCount * 44 +
			params.file.metadataSignals.headingPrefixCount * 18 +
			(params.file.metadataSignals.headingMetaHit ? 18 : 0) +
			params.file.metadataSignals.aliasExactCount * 36 +
			params.file.metadataSignals.aliasPrefixCount * 14 +
			(params.file.metadataSignals.aliasHit ? 14 : 0),
		localSignals: {
			coverageCount,
			exactCount,
			prefixCount,
			fuzzyCount: 0,
			queryTermCount: termStats.length,
			missCount,
			occurrenceCount: matchOccurrences.length,
			occurrenceSpread: computeOccurrenceSpread({ occurrences: matchOccurrences }),
			distancePenaltyTotal: 0,
			distancePenaltyMax: 0,
			spanLength: Math.max(1, endOffset - anchorOffset),
			anchorOffset,
		},
		termStats,
		matchOccurrences,
		bridgePreviewText: metadataPreview.text,
		bridgePreviewRanges: metadataPreview.highlightRanges,
		bridgePreviewSegmentText: metadataPreview.segmentText,
	};
}

function createFocusedHeadingBridgeCandidate(params: {
	queryTerms: readonly DirectSubitemsQueryTerm[];
	file: HybridLexicalLaneFileCandidate;
	snapshotText: string;
	lineOffsets: number[];
	headingOutline: Array<{ line: number; level: number; title: string }>;
	headingChainByLine: string[][];
}): HybridLexicalLaneBlockCandidate | null {
	if (!params.queryTerms.some((term) => term.kind === "non_han_run" && term.rawText.includes("-"))) {
		return null;
	}
	const headingEntries = buildMetadataBridgeEntries(
		params.file,
		params.headingOutline,
	).filter((entry) => entry.kind === "heading");
	const bestHeadingMatch = headingEntries
		.map((entry) => ({
			entry,
			exactCount: params.queryTerms.filter(
				(term) => classifyFocusedBridgeTermMatch(term, entry.text) === "exact",
			).length,
			prefixCount: params.queryTerms.filter(
				(term) => classifyFocusedBridgeTermMatch(term, entry.text) === "prefix",
			).length,
		}))
		.map((entryMatch) => ({
			...entryMatch,
			coverageCount: entryMatch.exactCount + entryMatch.prefixCount,
			score: entryMatch.exactCount * 12 + entryMatch.prefixCount * 5,
		}))
		.filter((entryMatch) => entryMatch.exactCount >= 2 && entryMatch.coverageCount >= 2)
		.sort(
			(left, right) =>
				right.score - left.score ||
				right.coverageCount - left.coverageCount ||
				right.exactCount - left.exactCount,
		)[0];
	if (!bestHeadingMatch) {
		return null;
	}
	const basename = FileUtil.getBasename(params.file.filePath);
	const previewText = `Heading: ${bestHeadingMatch.entry.text} | File: ${basename}`;
	const anchorOffset = resolveFocusedHeadingAnchorOffset({
		headingText: bestHeadingMatch.entry.text,
		snapshotText: params.snapshotText,
		headingOutline: params.headingOutline,
		lineOffsets: params.lineOffsets,
	});
	const endOffset = Math.min(
		params.snapshotText.length,
		Math.max(anchorOffset + 1, anchorOffset + 220),
	);
	const startLine = offsetToLine(params.lineOffsets, anchorOffset);
	const endLine = offsetToLine(
		params.lineOffsets,
		Math.max(anchorOffset, endOffset - 1),
	);
	const startLineOffset = params.lineOffsets[startLine] ?? 0;
	const endLineOffset = params.lineOffsets[endLine] ?? 0;
	const termStats = params.queryTerms.map((term) => ({
		termId: term.termId,
		bestTier: classifyFocusedBridgeTermMatch(term, previewText),
		bestDistancePenalty: 0,
	}));
	const coverageCount = termStats.filter((termStat) => termStat.bestTier !== "miss").length;
	const exactCount = termStats.filter((termStat) => termStat.bestTier === "exact").length;
	const prefixCount = termStats.filter((termStat) => termStat.bestTier === "prefix").length;
	const missCount = termStats.length - coverageCount;
	const matchOccurrences = collectFocusedBridgeMatchOccurrences({
		queryTerms: params.queryTerms,
		previewText,
		anchorOffset,
		maxSpanLength: Math.max(1, endOffset - anchorOffset),
	});
	return {
		filePath: params.file.filePath,
		blockId: `${params.file.filePath}#focused-heading-bridge-${anchorOffset}-${endOffset}`,
		startOffset: anchorOffset,
		endOffset,
		startLine,
		startCol: Math.max(0, anchorOffset - startLineOffset),
		endLine,
		endCol: Math.max(0, endOffset - endLineOffset),
		text: params.snapshotText.slice(anchorOffset, endOffset),
		headingChain: [...(params.headingChainByLine[startLine] ?? [])],
		parentFileScore: params.file.fileScore,
		parentFileRank: params.file.fileRank,
		parentMetadataSignals: { ...params.file.metadataSignals },
		localScore:
			coverageCount * 62 +
			exactCount * 54 +
			prefixCount * 18 +
			bestHeadingMatch.exactCount * 44 +
			bestHeadingMatch.coverageCount * 24,
		localSignals: {
			coverageCount,
			exactCount,
			prefixCount,
			fuzzyCount: 0,
			queryTermCount: termStats.length,
			missCount,
			occurrenceCount: matchOccurrences.length,
			occurrenceSpread: computeOccurrenceSpread({ occurrences: matchOccurrences }),
			distancePenaltyTotal: 0,
			distancePenaltyMax: 0,
			spanLength: Math.max(1, endOffset - anchorOffset),
			anchorOffset,
		},
		termStats,
		matchOccurrences,
		bridgePreviewText: previewText,
		bridgePreviewRanges: buildFocusedBridgeHighlightRanges(params.queryTerms, previewText),
		bridgePreviewSegmentText: "Heading > File",
	};
}

function createFileRecallBridgeCandidate(params: {
	queryTerms: readonly DirectSubitemsQueryTerm[];
	file: HybridLexicalLaneFileCandidate;
	snapshotText: string;
	lineOffsets: number[];
	headingChainByLine: string[][];
}): HybridLexicalLaneBlockCandidate | null {
	if (params.queryTerms.length === 0) {
		return null;
	}

	const normalizedSnapshot = params.snapshotText.toLocaleLowerCase();
	const wordOccurrences = buildAsciiWordOccurrences(params.snapshotText);
	const matchOccurrences: HybridLexicalLaneBlockCandidate["matchOccurrences"] = [];
	const termStats = params.queryTerms.map((term) => {
		const matchedOccurrence = resolveFileRecallTermOccurrence({
			term,
			snapshotText: params.snapshotText,
			normalizedSnapshot,
			wordOccurrences,
		});
		if (matchedOccurrence === null) {
			return {
				termId: term.termId,
				bestTier: "miss" as const,
				bestDistancePenalty: 0,
			};
		}
		matchOccurrences.push(matchedOccurrence);
		return {
			termId: term.termId,
			bestTier: matchedOccurrence.tier,
			bestDistancePenalty: 0,
		};
	});
	const coverageCount = termStats.filter((termStat) => termStat.bestTier !== "miss").length;
	if (coverageCount === 0) {
		return null;
	}
	const exactCount = termStats.filter(
		(termStat) => termStat.bestTier === "exact",
	).length;
	const prefixCount = termStats.filter(
		(termStat) => termStat.bestTier === "prefix",
	).length;

	const coverageRatio = coverageCount / Math.max(1, params.queryTerms.length);
	if (
		coverageRatio < 0.55 &&
		params.file.fileRank > 2 &&
		params.file.fileScore <= 0
	) {
		return null;
	}
	const bridgeMetadataBonus =
		coverageRatio >= 0.55
			? (params.file.metadataSignals.aliasHit ? 18 : 0) +
				params.file.metadataSignals.aliasContainedInQueryCount * 18 +
				params.file.metadataSignals.aliasTokenCoverageCount * 8 +
				(params.file.metadataSignals.basenameContainedInQuery ? 12 : 0) +
				params.file.metadataSignals.basenameTokenCoverageCount * 5 +
				params.file.metadataSignals.headingContainedInQueryCount * 8 +
				params.file.metadataSignals.headingTokenCoverageCount * 4
			: 0;
	matchOccurrences.sort((left, right) => left.start - right.start);
	const anchorOffset =
		matchOccurrences[0]?.start ??
		resolveFileRecallAnchorOffset(params.snapshotText);
	const endOffset = Math.min(
		params.snapshotText.length,
		Math.max(anchorOffset + 1, anchorOffset + 220),
	);
	const startLine = offsetToLine(params.lineOffsets, anchorOffset);
	const endLine = offsetToLine(
		params.lineOffsets,
		Math.max(anchorOffset, endOffset - 1),
	);
	const startLineOffset = params.lineOffsets[startLine] ?? 0;
	const endLineOffset = params.lineOffsets[endLine] ?? 0;
	const missCount = termStats.length - coverageCount;
	return {
		filePath: params.file.filePath,
		blockId: `${params.file.filePath}#file-recall-bridge-${anchorOffset}-${endOffset}`,
		startOffset: anchorOffset,
		endOffset,
		startLine,
		startCol: Math.max(0, anchorOffset - startLineOffset),
		endLine,
		endCol: Math.max(0, endOffset - endLineOffset),
		text: params.snapshotText.slice(anchorOffset, endOffset),
		headingChain: [...(params.headingChainByLine[startLine] ?? [])],
		parentFileScore: params.file.fileScore,
		parentFileRank: params.file.fileRank,
		parentMetadataSignals: { ...params.file.metadataSignals },
		localScore:
			coverageCount * 24 +
			exactCount * 22 +
			prefixCount * 8 +
			coverageRatio * 96 +
			bridgeMetadataBonus +
			Math.max(0, 8 - params.file.fileRank) * 10,
		localSignals: {
			coverageCount,
			exactCount,
			prefixCount,
			fuzzyCount: 0,
			queryTermCount: termStats.length,
			missCount,
			occurrenceCount: matchOccurrences.length,
			occurrenceSpread:
				matchOccurrences.length <= 1
					? 0
					: matchOccurrences[matchOccurrences.length - 1].end -
						matchOccurrences[0].start,
			distancePenaltyTotal: 0,
			distancePenaltyMax: 0,
			spanLength: Math.max(1, endOffset - anchorOffset),
			anchorOffset,
		},
		termStats,
		matchOccurrences,
	};
}

function resolveFileRecallAnchorOffset(snapshotText: string): number {
	const firstHeadingIndex = snapshotText.search(/^#{1,6}\s+/m);
	if (firstHeadingIndex >= 0) {
		return firstHeadingIndex;
	}
	return 0;
}

type FileRecallWordOccurrence = {
	word: string;
	start: number;
	end: number;
};

function buildAsciiWordOccurrences(snapshotText: string): FileRecallWordOccurrence[] {
	const matches = snapshotText.matchAll(/[A-Za-z0-9_-]+/g);
	const occurrences: FileRecallWordOccurrence[] = [];
	for (const match of matches) {
		const word = match[0];
		const start = match.index ?? 0;
		occurrences.push({
			word: word.toLocaleLowerCase(),
			start,
			end: start + word.length,
		});
	}
	return occurrences;
}

function resolveFileRecallTermOccurrence(params: {
	term: DirectSubitemsQueryTerm;
	snapshotText: string;
	normalizedSnapshot: string;
	wordOccurrences: readonly FileRecallWordOccurrence[];
}):
	| {
			termId: string;
			tier: "exact" | "prefix";
			start: number;
			end: number;
			distancePenalty: number;
	  }
	| null {
	const { term, snapshotText, normalizedSnapshot, wordOccurrences } = params;
	const needle = term.kind === "han_char" ? term.rawText : term.normalizedText;
	const haystack = term.kind === "han_char" ? snapshotText : normalizedSnapshot;
	const start = haystack.indexOf(needle);
	if (start >= 0) {
		return {
			termId: term.termId,
			tier: "exact",
			start,
			end: start + term.rawText.length,
			distancePenalty: 0,
		};
	}
	if (term.kind !== "non_han_run") {
		return null;
	}
	const comparableQueryForms = buildComparableEnglishForms(term.normalizedText);
	if (comparableQueryForms.length === 0) {
		return null;
	}
	const matchedWord = wordOccurrences.find((occurrence) =>
		buildComparableEnglishForms(occurrence.word).some((candidateForm) =>
			comparableQueryForms.some(
				(queryForm) =>
					queryForm === candidateForm ||
					queryForm.startsWith(candidateForm) ||
					candidateForm.startsWith(queryForm),
			),
		),
	);
	if (!matchedWord) {
		return null;
	}
	return {
		termId: term.termId,
		tier: "prefix",
		start: matchedWord.start,
		end: matchedWord.end,
		distancePenalty: 0,
	};
}

function buildComparableEnglishForms(token: string): string[] {
	const normalized = token.trim().toLocaleLowerCase();
	if (!/^[a-z][a-z0-9_-]{4,}$/u.test(normalized)) {
		return [normalized].filter((value) => value.length > 0);
	}
	const forms = new Set<string>([normalizeEnglishToken(normalized)]);
	if (normalized.endsWith("e") && normalized.length > 5) {
		forms.add(normalized.slice(0, -1));
	}
	if (normalized.endsWith("ing") && normalized.length > 6) {
		const stem = normalized.slice(0, -3);
		forms.add(stem);
		forms.add(`${stem}e`);
	}
	if (normalized.endsWith("ed") && normalized.length > 5) {
		const stem = normalized.slice(0, -2);
		forms.add(stem);
		forms.add(`${stem}e`);
	}
	if (normalized.endsWith("tion") && normalized.length > 6) {
		forms.add(normalized.slice(0, -3));
	}
	if (normalized.endsWith("ation") && normalized.length > 7) {
		forms.add(`${normalized.slice(0, -5)}e`);
	}
	return [...forms].filter((value) => value.length > 0);
}

function normalizeEnglishToken(token: string): string {
	if (token.endsWith("ies") && token.length > 5) {
		return `${token.slice(0, -3)}y`;
	}
	if (token.endsWith("s") && token.length > 5) {
		return token.slice(0, -1);
	}
	return token;
}

type MetadataBridgeEntry = {
	kind: "basename" | "path" | "alias" | "heading";
	text: string;
};

function buildMetadataBridgeEntries(
	file: HybridLexicalLaneFileCandidate,
	headingOutline: Array<{ line: number; level: number; title: string }>,
): MetadataBridgeEntry[] {
	const headingValues = new Set(
		[...file.metadataValues.headings, ...headingOutline.map((heading) => heading.title)]
			.map((value) => value.replace(/\s+/g, " ").trim())
			.filter((value) => value.length > 0),
	);
	return [
		{ kind: "basename", text: FileUtil.getBasename(file.filePath) },
		{ kind: "path", text: file.filePath },
		...file.metadataValues.aliases
			.map((alias) => alias.replace(/\s+/g, " ").trim())
			.filter((alias) => alias.length > 0)
			.map((alias) => ({ kind: "alias", text: alias }) as const),
		...[...headingValues].map(
			(heading) => ({ kind: "heading", text: heading }) as const,
		),
	];
}

function buildMetadataBridgePreview(
	queryTerms: readonly DirectSubitemsQueryTerm[],
	entries: readonly MetadataBridgeEntry[],
):
	| {
			text: string;
			highlightRanges: Array<{ start: number; end: number }>;
			segmentText: string;
	  }
	| null {
	const rankedEntries = entries
		.map((entry) => ({
			entry,
			score: computeMetadataBridgeEntryScore(queryTerms, entry),
		}))
		.filter((item) => item.score > 0)
		.sort((left, right) => right.score - left.score)
		.slice(0, 3);
	if (rankedEntries.length === 0) {
		return null;
	}
	const text = rankedEntries
		.map(({ entry }) => `${formatMetadataBridgeLabel(entry.kind)}: ${entry.text}`)
		.join(" | ");
	return {
		text,
		highlightRanges: buildMetadataPreviewHighlightRanges(
			queryTerms,
			text,
		),
		segmentText: rankedEntries
			.map(({ entry }) => formatMetadataBridgeLabel(entry.kind))
			.join(" > "),
	};
}

function computeMetadataBridgeEntryScore(
	queryTerms: readonly DirectSubitemsQueryTerm[],
	entry: MetadataBridgeEntry,
): number {
	return queryTerms.reduce((sum, term) => {
		const tier = classifyMetadataTermMatch(term, [entry.text]);
		if (tier === "exact") {
			return sum + 8;
		}
		if (tier === "prefix") {
			return sum + 4;
		}
		return sum;
	}, 0);
}

function formatMetadataBridgeLabel(kind: MetadataBridgeEntry["kind"]): string {
	if (kind === "basename") {
		return "File";
	}
	if (kind === "path") {
		return "Path";
	}
	if (kind === "alias") {
		return "Alias";
	}
	return "Heading";
}

function classifyMetadataTermMatch(
	term: DirectSubitemsQueryTerm,
	metadataTexts: readonly string[],
): DirectSubitemsMatchTier {
	const normalizedTerm = normalizeForMetadata(term.normalizedText);
	if (normalizedTerm.length === 0) {
		return "miss";
	}
	for (const metadataText of metadataTexts) {
		const normalizedMetadata = normalizeForMetadata(metadataText);
		if (normalizedMetadata.includes(normalizedTerm)) {
			return "exact";
		}
	}
	for (const metadataText of metadataTexts) {
		const normalizedMetadata = normalizeForMetadata(metadataText);
		if (
			normalizedMetadata
				.split(/[^0-9a-z\u4e00-\u9fff_-]+/u)
				.some((part) => part.startsWith(normalizedTerm))
		) {
			return "prefix";
		}
	}
	return "miss";
}

function resolveMetadataAnchorOffset(
	queryTerms: readonly DirectSubitemsQueryTerm[],
	snapshotText: string,
	headingOutline: Array<{ line: number; level: number; title: string }>,
	lineOffsets: number[],
): number {
	for (const heading of headingOutline) {
		const normalizedTitle = normalizeForMetadata(heading.title);
		if (
			queryTerms.some((term) =>
				normalizedTitle.includes(normalizeForMetadata(term.normalizedText)),
			)
		) {
			return lineOffsets[heading.line] ?? 0;
		}
	}
	const normalizedSnapshot = snapshotText.toLocaleLowerCase();
	for (const term of queryTerms) {
		const offset = normalizedSnapshot.indexOf(term.normalizedText.toLocaleLowerCase());
		if (offset >= 0) {
			return offset;
		}
	}
	return 0;
}

function collectBridgeMatchOccurrences(params: {
	queryTerms: readonly DirectSubitemsQueryTerm[];
	previewText: string;
	anchorOffset: number;
	maxSpanLength: number;
}): Array<{
	termId: string;
	tier: "exact";
	start: number;
	end: number;
		distancePenalty: number;
	}> {
	const snippetText = params.previewText.toLocaleLowerCase();
	const occurrences: Array<{
		termId: string;
		tier: "exact";
		start: number;
		end: number;
		distancePenalty: number;
	}> = [];
	for (const term of params.queryTerms) {
		const normalizedTerm = term.normalizedText.toLocaleLowerCase();
		if (normalizedTerm.length === 0) {
			continue;
		}
		const localOffset = snippetText.indexOf(normalizedTerm);
		if (localOffset < 0) {
			continue;
		}
		occurrences.push({
			termId: term.termId,
			tier: "exact",
			start:
				params.anchorOffset +
				Math.min(localOffset, Math.max(0, params.maxSpanLength - 1)),
			end:
				params.anchorOffset +
				Math.min(
					localOffset + normalizedTerm.length,
					Math.max(1, params.maxSpanLength),
				),
			distancePenalty: 0,
		});
	}
	return occurrences;
}

function normalizeForMetadata(text: string): string {
	return text.trim().toLocaleLowerCase();
}

function buildMetadataPreviewHighlightRanges(
	queryTerms: readonly DirectSubitemsQueryTerm[],
	previewText: string,
): Array<{ start: number; end: number }> {
	const normalizedPreview = previewText.toLocaleLowerCase();
	const ranges: Array<{ start: number; end: number }> = [];
	for (const term of queryTerms) {
		const normalizedTerm = term.normalizedText.toLocaleLowerCase();
		if (normalizedTerm.length === 0) {
			continue;
		}
		let fromIndex = 0;
		while (fromIndex < normalizedPreview.length) {
			const matchIndex = normalizedPreview.indexOf(normalizedTerm, fromIndex);
			if (matchIndex < 0) {
				break;
			}
			ranges.push({
				start: matchIndex,
				end: matchIndex + normalizedTerm.length,
			});
			fromIndex = matchIndex + normalizedTerm.length;
		}
	}
	return ranges.sort((left, right) => left.start - right.start);
}

function classifyFocusedBridgeTermMatch(
	term: DirectSubitemsQueryTerm,
	text: string,
): DirectSubitemsMatchTier {
	const normalizedTerm = normalizeForFocusedBridge(term.normalizedText);
	if (normalizedTerm.length === 0) {
		return "miss";
	}
	const normalizedText = normalizeForFocusedBridge(text);
	if (normalizedText.includes(normalizedTerm)) {
		return "exact";
	}
	if (
		normalizedText
			.split(/[^0-9a-z\u4e00-\u9fff]+/u)
			.some((part) => part.startsWith(normalizedTerm))
	) {
		return "prefix";
	}
	return "miss";
}

function normalizeForFocusedBridge(text: string): string {
	return text
		.trim()
		.toLocaleLowerCase()
		.replace(/[-_]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function resolveFocusedHeadingAnchorOffset(params: {
	headingText: string;
	snapshotText: string;
	headingOutline: Array<{ line: number; level: number; title: string }>;
	lineOffsets: number[];
}): number {
	const matchingHeading = params.headingOutline.find(
		(heading) =>
			normalizeForFocusedBridge(heading.title) ===
			normalizeForFocusedBridge(params.headingText),
	);
	if (matchingHeading) {
		return params.lineOffsets[matchingHeading.line] ?? 0;
	}
	const normalizedSnapshot = normalizeForFocusedBridge(params.snapshotText);
	const normalizedHeading = normalizeForFocusedBridge(params.headingText);
	const snapshotOffset = normalizedSnapshot.indexOf(normalizedHeading);
	return snapshotOffset >= 0 ? snapshotOffset : 0;
}

function collectFocusedBridgeMatchOccurrences(params: {
	queryTerms: readonly DirectSubitemsQueryTerm[];
	previewText: string;
	anchorOffset: number;
	maxSpanLength: number;
}): Array<{
	termId: string;
	tier: "exact";
	start: number;
	end: number;
	distancePenalty: number;
}> {
	const normalizedPreview = normalizeForFocusedBridge(params.previewText);
	const occurrences: Array<{
		termId: string;
		tier: "exact";
		start: number;
		end: number;
		distancePenalty: number;
	}> = [];
	for (const term of params.queryTerms) {
		const normalizedTerm = normalizeForFocusedBridge(term.normalizedText);
		if (normalizedTerm.length === 0) {
			continue;
		}
		const localOffset = normalizedPreview.indexOf(normalizedTerm);
		if (localOffset < 0) {
			continue;
		}
		occurrences.push({
			termId: term.termId,
			tier: "exact",
			start:
				params.anchorOffset +
				Math.min(localOffset, Math.max(0, params.maxSpanLength - 1)),
			end:
				params.anchorOffset +
				Math.min(
					localOffset + normalizedTerm.length,
					Math.max(1, params.maxSpanLength),
				),
			distancePenalty: 0,
		});
	}
	return occurrences;
}

function buildFocusedBridgeHighlightRanges(
	queryTerms: readonly DirectSubitemsQueryTerm[],
	previewText: string,
): Array<{ start: number; end: number }> {
	const normalizedPreview = normalizeForFocusedBridge(previewText);
	const ranges: Array<{ start: number; end: number }> = [];
	for (const term of queryTerms) {
		const normalizedTerm = normalizeForFocusedBridge(term.normalizedText);
		if (normalizedTerm.length === 0) {
			continue;
		}
		let fromIndex = 0;
		while (fromIndex < normalizedPreview.length) {
			const matchIndex = normalizedPreview.indexOf(normalizedTerm, fromIndex);
			if (matchIndex < 0) {
				break;
			}
			ranges.push({
				start: matchIndex,
				end: matchIndex + normalizedTerm.length,
			});
			fromIndex = matchIndex + normalizedTerm.length;
		}
	}
	return ranges.sort((left, right) => left.start - right.start);
}

function buildHeadingChainsByLine(
	lineCount: number,
	outline: Array<{ line: number; level: number; title: string }>,
): string[][] {
	const chainsByLine: string[][] = new Array(lineCount);
	const stack: Array<{ line: number; level: number; title: string }> = [];
	const sortedOutline = [...outline]
		.filter((entry) => entry.title.trim().length > 0 && entry.line >= 0)
		.sort((left, right) => left.line - right.line || left.level - right.level);
	let outlineIndex = 0;

	for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
		while (
			outlineIndex < sortedOutline.length &&
			sortedOutline[outlineIndex].line === lineIndex
		) {
			const heading = sortedOutline[outlineIndex];
			while (stack.length > 0 && stack[stack.length - 1].level >= heading.level) {
				stack.pop();
			}
			stack.push({
				line: heading.line,
				level: heading.level,
				title: heading.title.replace(/\s+/g, " ").trim(),
			});
			outlineIndex += 1;
		}
		chainsByLine[lineIndex] = stack.map((entry) => entry.title);
	}

	return chainsByLine;
}
