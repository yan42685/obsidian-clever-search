import { buildLineOffsets, offsetToLine } from "../../hybrid/chunker";
import { LangUtil } from "src/utils/lang-util";
import type {
	DirectSubitemsCandidateSpan,
	DirectSubitemsOccurrence,
	DirectSubitemsRenderPayload,
} from "./contracts";
import { filterDisplayEligibleOccurrences } from "./occurrence-structure";

const DISPLAY_PRE_CHARS_WIDE = 60;
const DISPLAY_POST_CHARS_WIDE = 80;
const DISPLAY_PRE_CHARS_NARROW = 180;
const DISPLAY_POST_CHARS_NARROW = 200;
const DEFAULT_DISPLAY_MAX_CHARS = 200;
const MAX_DISPLAY_LINES_PER_SIDE = 2;

type DisplayWindow = {
	start: number;
	end: number;
};

type LineInfo = {
	index: number;
	start: number;
	end: number;
	text: string;
	isBlank: boolean;
};

type LineWindow = {
	startLine: number;
	endLine: number;
};

export function renderDirectSubitemsCandidateSpan(params: {
	snapshotText: string;
	span: DirectSubitemsCandidateSpan;
	maxChars?: number;
}): DirectSubitemsRenderPayload {
	const { snapshotText, span } = params;
	const maxChars = Math.max(1, params.maxChars ?? DEFAULT_DISPLAY_MAX_CHARS);
	const lineOffsets = buildLineOffsets(snapshotText);
	const lineInfos = buildLineInfos(snapshotText, lineOffsets);
	const displayOccurrences = filterDisplayEligibleOccurrences(span.occurrences);
	const displayWindow = buildDisplayWindow({
		snapshotText,
		lineInfos,
		span: {
			...span,
			occurrences: displayOccurrences,
		},
		maxChars,
	});
	const snippetText = snapshotText.slice(displayWindow.start, displayWindow.end);
	const row = offsetToLine(lineOffsets, span.anchorOffset);
	const lineStartOffset = lineOffsets[row] ?? 0;
	const col = Math.max(0, span.anchorOffset - lineStartOffset);
	const baseHighlightRanges = mergeRanges(
		displayOccurrences
			.filter(
				(occurrence) =>
					occurrence.start >= displayWindow.start &&
					occurrence.end <= displayWindow.end,
			)
			.map((occurrence) => ({
				start: occurrence.start - displayWindow.start,
				end: occurrence.end - displayWindow.start,
			})),
	);
	return {
		text: snippetText,
		html: renderHighlightedSnippet(snippetText, baseHighlightRanges),
		snippetText,
		row,
		col,
		coreStart: span.start,
		coreEnd: span.end,
		displayStart: displayWindow.start,
		displayEnd: displayWindow.end,
		anchorOffset: span.anchorOffset,
		highlightRanges: baseHighlightRanges,
	};
}

export function renderDirectSubitemsCandidateSpans(params: {
	snapshotText: string;
	spans: readonly DirectSubitemsCandidateSpan[];
	maxChars?: number;
}): DirectSubitemsRenderPayload[] {
	return params.spans.map((span) =>
		renderDirectSubitemsCandidateSpan({
			snapshotText: params.snapshotText,
			span,
			maxChars: params.maxChars,
		}),
	);
}

function buildDisplayWindow(params: {
	snapshotText: string;
	lineInfos: readonly LineInfo[];
	span: DirectSubitemsCandidateSpan;
	maxChars: number;
}): DisplayWindow {
	const { snapshotText, lineInfos, span, maxChars } = params;
	const representativeOccurrences = pickRepresentativeOccurrences(span.occurrences);
	const lineOffsets = lineInfos.map((line) => line.start);
	const seedWindow = buildSeedLineWindow(lineOffsets, representativeOccurrences);
	if (seedWindow) {
		const seedLength = computeLineWindowLength(lineInfos, seedWindow);
		if (seedLength <= maxChars) {
			const expandedWindow = expandDisplayLineWindow({
				lineInfos,
				seedWindow,
				maxChars,
			});
			const trimmedWindow = trimBlankLineEdges(lineInfos, expandedWindow);
			return lineWindowToOffsets(lineInfos, trimmedWindow);
		}
	}
	const fallbackStart =
		representativeOccurrences.length > 0
			? Math.min(...representativeOccurrences.map((occurrence) => occurrence.start))
			: span.start;
	const fallbackEnd =
		representativeOccurrences.length > 0
			? Math.max(...representativeOccurrences.map((occurrence) => occurrence.end))
			: span.end;
	return buildInlineDisplayWindow({
		snapshotText,
		coverStart: fallbackStart,
		coverEnd: fallbackEnd,
		maxChars,
	});
}

function buildLineInfos(snapshotText: string, lineOffsets: readonly number[]): LineInfo[] {
	return lineOffsets.map((start, index) => {
		const nextLineStart = lineOffsets[index + 1];
		const end = nextLineStart === undefined ? snapshotText.length : nextLineStart - 1;
		const text = snapshotText.slice(start, end);
		return {
			index,
			start,
			end,
			text,
			isBlank: text.trim().length === 0,
		};
	});
}

function pickRepresentativeOccurrences(
	occurrences: readonly DirectSubitemsOccurrence[],
): DirectSubitemsOccurrence[] {
	const bestByTerm = new Map<string, DirectSubitemsOccurrence>();
	for (const occurrence of occurrences) {
		const existing = bestByTerm.get(occurrence.termId);
		if (!existing || compareOccurrencesForDisplay(occurrence, existing) < 0) {
			bestByTerm.set(occurrence.termId, occurrence);
		}
	}
	return [...bestByTerm.values()].sort((left, right) => {
		if (left.start !== right.start) {
			return left.start - right.start;
		}
		if (left.end !== right.end) {
			return left.end - right.end;
		}
		return compareTierRank(left.tier, right.tier);
	});
}

function compareOccurrencesForDisplay(
	left: DirectSubitemsOccurrence,
	right: DirectSubitemsOccurrence,
): number {
	const tierRank = compareTierRank(left.tier, right.tier);
	if (tierRank !== 0) {
		return tierRank;
	}
	if (left.distancePenalty !== right.distancePenalty) {
		return left.distancePenalty - right.distancePenalty;
	}
	if (left.start !== right.start) {
		return left.start - right.start;
	}
	return left.end - right.end;
}

function compareTierRank(
	left: DirectSubitemsOccurrence["tier"],
	right: DirectSubitemsOccurrence["tier"],
): number {
	return tierRankValue(left) - tierRankValue(right);
}

function tierRankValue(tier: DirectSubitemsOccurrence["tier"]): number {
	switch (tier) {
		case "exact":
			return 0;
		case "prefix":
			return 1;
		case "fuzzy":
			return 2;
		default:
			return 3;
	}
}

function buildSeedLineWindow(
	lineOffsets: readonly number[],
	representativeOccurrences: readonly DirectSubitemsOccurrence[],
): LineWindow | null {
	if (lineOffsets.length === 0 || representativeOccurrences.length === 0) {
		return null;
	}
	const startLine = Math.min(
		...representativeOccurrences.map((occurrence) =>
			offsetToLine(lineOffsets as number[], occurrence.start),
		),
	);
	const endLine = Math.max(
		...representativeOccurrences.map((occurrence) =>
			offsetToLine(
				lineOffsets as number[],
				Math.max(occurrence.start, occurrence.end - 1),
			),
		),
	);
	return { startLine, endLine };
}

function expandDisplayLineWindow(params: {
	lineInfos: readonly LineInfo[];
	seedWindow: LineWindow;
	maxChars: number;
}): LineWindow {
	const { lineInfos, seedWindow, maxChars } = params;
	let startLine = seedWindow.startLine;
	let endLine = seedWindow.endLine;
	let upLinesAdded = 0;
	let downLinesAdded = 0;

	while (true) {
		let expandedThisRound = false;
		for (const direction of buildExpansionOrder({
			seedWindow,
			startLine,
			endLine,
		})) {
			if (direction === "up") {
				if (upLinesAdded >= MAX_DISPLAY_LINES_PER_SIDE || startLine <= 0) {
					continue;
				}
				const candidateWindow = { startLine: startLine - 1, endLine };
				if (computeLineWindowLength(lineInfos, candidateWindow) > maxChars) {
					continue;
				}
				startLine -= 1;
				upLinesAdded += 1;
				expandedThisRound = true;
				continue;
			}
			if (downLinesAdded >= MAX_DISPLAY_LINES_PER_SIDE || endLine >= lineInfos.length - 1) {
				continue;
			}
			const candidateWindow = { startLine, endLine: endLine + 1 };
			if (computeLineWindowLength(lineInfos, candidateWindow) > maxChars) {
				continue;
			}
			endLine += 1;
			downLinesAdded += 1;
			expandedThisRound = true;
		}
		if (!expandedThisRound) {
			break;
		}
	}

	return { startLine, endLine };
}

function buildExpansionOrder(params: {
	seedWindow: LineWindow;
	startLine: number;
	endLine: number;
}): Array<"up" | "down"> {
	const upDistance = params.seedWindow.startLine - params.startLine;
	const downDistance = params.endLine - params.seedWindow.endLine;
	return upDistance <= downDistance ? ["up", "down"] : ["down", "up"];
}

function computeLineWindowLength(
	lineInfos: readonly LineInfo[],
	window: LineWindow,
): number {
	const offsets = lineWindowToOffsets(lineInfos, window);
	return offsets.end - offsets.start;
}

function trimBlankLineEdges(
	lineInfos: readonly LineInfo[],
	window: LineWindow,
): LineWindow {
	let startLine = window.startLine;
	let endLine = window.endLine;
	while (startLine < endLine && lineInfos[startLine]?.isBlank) {
		startLine += 1;
	}
	while (endLine > startLine && lineInfos[endLine]?.isBlank) {
		endLine -= 1;
	}
	return { startLine, endLine };
}

function lineWindowToOffsets(
	lineInfos: readonly LineInfo[],
	window: LineWindow,
): DisplayWindow {
	const start = lineInfos[window.startLine]?.start ?? 0;
	const end = lineInfos[window.endLine]?.end ?? start;
	return { start, end };
}

function buildInlineDisplayWindow(params: {
	snapshotText: string;
	coverStart: number;
	coverEnd: number;
	maxChars: number;
}): DisplayWindow {
	const { snapshotText, coverStart, coverEnd, maxChars } = params;
	const clampedCoverStart = Math.max(0, Math.min(coverStart, snapshotText.length));
	const clampedCoverEnd = Math.max(clampedCoverStart, Math.min(coverEnd, snapshotText.length));
	const coreText = snapshotText.slice(clampedCoverStart, clampedCoverEnd);
	const isWideCharContext = LangUtil.testWideChar(coreText);
	const preChars = isWideCharContext
		? DISPLAY_PRE_CHARS_WIDE
		: DISPLAY_PRE_CHARS_NARROW;
	const postChars = isWideCharContext
		? DISPLAY_POST_CHARS_WIDE
		: DISPLAY_POST_CHARS_NARROW;
	const coverLength = clampedCoverEnd - clampedCoverStart;
	if (coverLength >= maxChars) {
		return {
			start: clampedCoverStart,
			end: Math.min(snapshotText.length, clampedCoverStart + maxChars),
		};
	}
	const extraChars = maxChars - coverLength;
	const totalWeight = preChars + postChars;
	const extraLeft = Math.floor((extraChars * preChars) / totalWeight);
	const extraRight = extraChars - extraLeft;
	let window: DisplayWindow = {
		start: Math.max(0, clampedCoverStart - extraLeft),
		end: Math.min(snapshotText.length, clampedCoverEnd + extraRight),
	};
	window = clampWindowToMaxChars(window, clampedCoverStart, clampedCoverEnd, maxChars);
	window = {
		start: trimInlineWindowStart(snapshotText, window.start, clampedCoverStart),
		end: trimInlineWindowEnd(snapshotText, window.end, clampedCoverEnd),
	};
	return clampWindowToMaxChars(window, clampedCoverStart, clampedCoverEnd, maxChars);
}

function clampWindowToMaxChars(
	window: DisplayWindow,
	coverStart: number,
	coverEnd: number,
	maxChars: number,
): DisplayWindow {
	let start = window.start;
	let end = window.end;
	let overflow = end - start - maxChars;
	if (overflow <= 0) {
		return { start, end };
	}
	const leftSlack = coverStart - start;
	const trimLeft = Math.min(leftSlack, Math.floor(overflow / 2));
	start += trimLeft;
	overflow -= trimLeft;
	const rightSlack = end - coverEnd;
	const trimRight = Math.min(rightSlack, overflow);
	end -= trimRight;
	overflow -= trimRight;
	if (overflow > 0) {
		const extraLeftTrim = Math.min(coverStart - start, overflow);
		start += extraLeftTrim;
		overflow -= extraLeftTrim;
	}
	if (overflow > 0) {
		end -= overflow;
	}
	return { start, end };
}

function trimInlineWindowStart(
	text: string,
	start: number,
	coverStart: number,
): number {
	for (let index = coverStart - 1; index >= start; index--) {
		if (isSoftBoundary(text[index])) {
			return index + 1;
		}
	}
	return start;
}

function trimInlineWindowEnd(
	text: string,
	end: number,
	coverEnd: number,
): number {
	for (let index = coverEnd; index < end; index++) {
		if (isSoftBoundary(text[index])) {
			return index;
		}
	}
	return end;
}

function isSoftBoundary(char: string | undefined): boolean {
	return !!char && /[\s.,;:!?()\[\]{}<>|/\\'"，。！？、；：]/u.test(char);
}

function renderHighlightedSnippet(
	snippetText: string,
	ranges: ReadonlyArray<{ start: number; end: number }>,
): string {
	if (ranges.length === 0) {
		return escapeHtml(snippetText);
	}
	let rendered = "";
	let cursor = 0;
	for (const range of mergeRanges(ranges)) {
		rendered += escapeHtml(snippetText.slice(cursor, range.start));
		rendered += `<mark>${escapeHtml(snippetText.slice(range.start, range.end))}</mark>`;
		cursor = range.end;
	}
	rendered += escapeHtml(snippetText.slice(cursor));
	return rendered;
}

function mergeRanges(
	ranges: ReadonlyArray<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
	if (ranges.length <= 1) {
		return [...ranges];
	}
	const ordered = [...ranges].sort((left, right) => left.start - right.start);
	const merged = [{ start: ordered[0].start, end: ordered[0].end }];
	for (let index = 1; index < ordered.length; index++) {
		const current = ordered[index];
		const previous = merged[merged.length - 1];
		if (current.start <= previous.end) {
			previous.end = Math.max(previous.end, current.end);
			continue;
		}
		merged.push({ start: current.start, end: current.end });
	}
	return merged;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}