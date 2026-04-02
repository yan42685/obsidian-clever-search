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
				maxBlocksPerFile: params.maxBlocksPerFile,
			}),
		);
	}

	return {
		blockCandidates,
		snapshotTextByPath,
	};
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
		options: {
			maxChars: 220,
			mergeGap: 32,
			contextLeft: 24,
			contextRight: 40,
			boundaryLookaround: 24,
		},
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
	const metadataTexts = [
		FileUtil.getBasename(params.file.filePath),
		params.file.filePath,
		...params.headingOutline.map((heading) => heading.title),
	];
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
		snapshotText: params.snapshotText,
		startOffset: anchorOffset,
		endOffset,
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
			(params.file.metadataSignals.headingMetaHit ? 18 : 0) +
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
	};
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
	snapshotText: string;
	startOffset: number;
	endOffset: number;
}): Array<{
	termId: string;
	tier: "exact";
	start: number;
	end: number;
	distancePenalty: number;
}> {
	const snippetText = params.snapshotText
		.slice(params.startOffset, params.endOffset)
		.toLocaleLowerCase();
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
			start: params.startOffset + localOffset,
			end: params.startOffset + localOffset + normalizedTerm.length,
			distancePenalty: 0,
		});
	}
	return occurrences;
}

function normalizeForMetadata(text: string): string {
	return text.trim().toLocaleLowerCase();
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
