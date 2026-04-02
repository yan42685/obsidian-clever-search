import { DataProvider } from "src/services/obsidian/user-data/data-provider";
import {
	buildDirectSubitemsExactCandidates,
	type DirectSubitemsCandidateSpan,
	type DirectSubitemsRenderPayload,
} from "../../coverage-lexical/direct-subitems";
import { buildLineOffsets, offsetToLine } from "../chunker";
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
		const headingOutline = dataProvider.getHeadingOutlineForText(
			file.filePath,
			snapshotText,
		);
		const headingChainByLine = buildHeadingChainsByLine(
			snapshotText.split("\n").length,
			headingOutline,
		);
		const directSubitems = buildDirectSubitemsExactCandidates({
			queryText: params.queryText,
			snapshotText,
			options: {
				maxChars: 220,
				mergeGap: 32,
				contextLeft: 24,
				contextRight: 40,
				boundaryLookaround: 24,
			},
		});
		const lineOffsets = buildLineOffsets(snapshotText);
		const limit = Math.max(0, params.maxBlocksPerFile);
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
			blockCandidates.push(
				createBlockCandidate({
					file,
					span,
					payload,
					lineOffsets,
					headingChainByLine,
					snapshotText,
				}),
			);
		}
	}

	return {
		blockCandidates,
		snapshotTextByPath,
	};
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
		localScore: computeLocalScore(span),
		localSignals: {
			coverageCount: span.score.coverageCount,
			exactCount: span.score.exactCount,
			prefixCount: span.score.prefixCount,
			fuzzyCount: span.score.fuzzyCount,
			distancePenaltyTotal: span.score.distancePenaltyTotal,
			distancePenaltyMax: span.score.distancePenaltyMax,
			spanLength: span.score.spanLength,
			anchorOffset: span.score.anchorOffset,
		},
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
	return (
		span.score.coverageCount * 3 +
		span.score.exactCount * 5 +
		span.score.prefixCount * 2 +
		span.score.fuzzyCount -
		span.score.distancePenaltyTotal * 0.5
	);
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
