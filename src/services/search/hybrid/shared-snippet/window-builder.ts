import { buildLineOffsets, estimateTokenCount } from "../chunker";
import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneRankedBlockCandidate,
} from "../lexical-lane/contracts";

const INLINE_EXPAND_STEP_CHARS = 36;

export function buildHybridSharedSnippetBodyWindow(params: {
	snapshotText: string;
	candidate: HybridLexicalLaneBlockCandidate | HybridLexicalLaneRankedBlockCandidate;
	bodyBudget: number;
}): { start: number; end: number } {
	const { snapshotText, candidate, bodyBudget } = params;
	const lineOffsets = buildLineOffsets(snapshotText);
	const lineCount = snapshotText.split("\n").length;
	let startLine = candidate.startLine;
	let endLine = candidate.endLine;
	let start = lineOffsets[startLine] ?? 0;
	let end = resolveLineEndOffset(snapshotText, lineOffsets, endLine);
	if (estimateTokenCount(snapshotText.slice(start, end)) > bodyBudget) {
		return buildInlineTokenWindow({
			snapshotText,
			anchorOffset: candidate.localSignals.anchorOffset,
			coverStart: candidate.startOffset,
			coverEnd: candidate.endOffset,
			bodyBudget,
		});
	}

	let preferUp = true;
	while (true) {
		let expanded = false;
		for (const direction of preferUp ? ["up", "down"] : ["down", "up"]) {
			if (direction === "up" && startLine > 0) {
				const nextStartLine = startLine - 1;
				const nextStart = lineOffsets[nextStartLine] ?? start;
				if (estimateTokenCount(snapshotText.slice(nextStart, end)) <= bodyBudget) {
					startLine = nextStartLine;
					start = nextStart;
					expanded = true;
					continue;
				}
			}
			if (direction === "down" && endLine < lineCount - 1) {
				const nextEndLine = endLine + 1;
				const nextEnd = resolveLineEndOffset(snapshotText, lineOffsets, nextEndLine);
				if (estimateTokenCount(snapshotText.slice(start, nextEnd)) <= bodyBudget) {
					endLine = nextEndLine;
					end = nextEnd;
					expanded = true;
				}
			}
		}
		if (!expanded) {
			break;
		}
		preferUp = !preferUp;
	}

	return {
		start: trimStartBoundary(snapshotText, start, candidate.startOffset),
		end: trimEndBoundary(snapshotText, end, candidate.endOffset),
	};
}

function buildInlineTokenWindow(params: {
	snapshotText: string;
	anchorOffset: number;
	coverStart: number;
	coverEnd: number;
	bodyBudget: number;
}): { start: number; end: number } {
	const { snapshotText, anchorOffset, coverStart, coverEnd, bodyBudget } = params;
	const anchor = Math.max(0, Math.min(anchorOffset, snapshotText.length));
	let start = Math.max(0, Math.min(coverStart, anchor));
	let end = Math.min(snapshotText.length, Math.max(coverEnd, anchor + 1));
	let growLeft = true;

	while (estimateTokenCount(snapshotText.slice(start, end)) < bodyBudget) {
		const previousStart = start;
		const previousEnd = end;
		if (growLeft && start > 0) {
			start = moveLeftBoundary(snapshotText, start, INLINE_EXPAND_STEP_CHARS);
		} else if (!growLeft && end < snapshotText.length) {
			end = moveRightBoundary(snapshotText, end, INLINE_EXPAND_STEP_CHARS);
		} else if (start > 0) {
			start = moveLeftBoundary(snapshotText, start, INLINE_EXPAND_STEP_CHARS);
		} else if (end < snapshotText.length) {
			end = moveRightBoundary(snapshotText, end, INLINE_EXPAND_STEP_CHARS);
		}
		if (previousStart === start && previousEnd === end) {
			break;
		}
		growLeft = !growLeft;
	}

	return {
		start: trimStartBoundary(snapshotText, start, coverStart),
		end: trimEndBoundary(snapshotText, end, coverEnd),
	};
}

function resolveLineEndOffset(
	snapshotText: string,
	lineOffsets: number[],
	line: number,
): number {
	const nextLineOffset = lineOffsets[line + 1];
	return nextLineOffset === undefined ? snapshotText.length : nextLineOffset - 1;
}

function moveLeftBoundary(text: string, start: number, maxChars: number): number {
	const candidate = Math.max(0, start - maxChars);
	for (let index = start - 1; index >= candidate; index--) {
		if (isSoftBoundary(text[index])) {
			return index + 1;
		}
	}
	return candidate;
}

function moveRightBoundary(text: string, end: number, maxChars: number): number {
	const candidate = Math.min(text.length, end + maxChars);
	for (let index = end; index < candidate; index++) {
		if (isSoftBoundary(text[index])) {
			return index;
		}
	}
	return candidate;
}

function trimStartBoundary(text: string, start: number, coverStart: number): number {
	for (let index = coverStart - 1; index >= start; index--) {
		if (isSoftBoundary(text[index])) {
			return index + 1;
		}
	}
	return start;
}

function trimEndBoundary(text: string, end: number, coverEnd: number): number {
	for (let index = coverEnd; index < end; index++) {
		if (isSoftBoundary(text[index])) {
			return index;
		}
	}
	return end;
}

function isSoftBoundary(char: string | undefined): boolean {
	return !!char && /[\s.,;:!?()\[\]{}<>|/\\'"\uFF0C\u3002\uFF01\uFF1F\u3001\uFF1B\uFF1A]/u.test(char);
}
