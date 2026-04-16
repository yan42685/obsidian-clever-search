import { buildLineOffsets, offsetToLine } from "../../hybrid/chunker";
import type {
	V3DirectSubitemCandidate,
	V3DirectSubitemOccurrence,
	V3DirectSubitemRenderPayload,
} from "./contracts";

const DISPLAY_PRE_CHARS_WIDE = 60;
const DISPLAY_POST_CHARS_WIDE = 80;
const DISPLAY_PRE_CHARS_NARROW = 180;
const DISPLAY_POST_CHARS_NARROW = 200;
const DEFAULT_DISPLAY_MAX_CHARS = 220;
const MAX_DISPLAY_LINES_PER_SIDE = 2;

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

type DisplayWindow = {
	start: number;
	end: number;
};

export function renderV3DirectSubitemCandidate(params: {
	snapshotText: string;
	candidate: V3DirectSubitemCandidate;
	maxChars?: number;
}): V3DirectSubitemRenderPayload {
	const snapshotText = params.snapshotText;
	const candidate = params.candidate;
	const maxChars = Math.max(1, params.maxChars ?? DEFAULT_DISPLAY_MAX_CHARS);
	const lineOffsets = buildLineOffsets(snapshotText);
	const lineInfos = buildLineInfos(snapshotText, lineOffsets);
	const displayWindow = buildDisplayWindow({
		snapshotText,
		lineInfos,
		candidate,
		maxChars,
	});
	const snippetText = snapshotText.slice(displayWindow.start, displayWindow.end);
	const row = offsetToLine(lineOffsets, candidate.anchorOffset);
	const lineStartOffset = lineOffsets[row] ?? 0;
	const highlightRanges = resolveHighlightRanges(candidate, displayWindow);
	return {
		text: snippetText,
		html: renderHighlightedSnippet(snippetText, highlightRanges),
		snippetText,
		row,
		col: Math.max(0, candidate.anchorOffset - lineStartOffset),
		coreStart: candidate.start,
		coreEnd: candidate.end,
		displayStart: displayWindow.start,
		displayEnd: displayWindow.end,
		anchorOffset: candidate.anchorOffset,
		highlightRanges,
	};
}

function resolveHighlightRanges(
	candidate: V3DirectSubitemCandidate,
	displayWindow: DisplayWindow,
): Array<{ start: number; end: number }> {
	const displayOccurrences = collapseSurfaceDisplayOccurrences(
		candidate.displayOccurrences,
	);
	const displayRanges = mapOccurrencesToDisplayRanges(
		displayOccurrences,
		displayWindow,
	);
	if (displayRanges.length > 0) {
		return mergeRanges(displayRanges);
	}
	return mergeRanges(
		mapOccurrencesToDisplayRanges(
			collapseSurfaceDisplayOccurrences(candidate.occurrences),
			displayWindow,
		),
	);
}

function collapseSurfaceDisplayOccurrences(
	occurrences: readonly V3DirectSubitemOccurrence[],
): V3DirectSubitemOccurrence[] {
	const realOccurrences = occurrences.filter(
		(occurrence) => occurrence.kind !== "surface_completion",
	);
	const bestSurfaceByGroup = new Map<number, V3DirectSubitemOccurrence>();
	for (const occurrence of occurrences) {
		if (
			occurrence.kind !== "surface_completion" ||
			occurrence.surfaceGroupIndex == null
		) {
			continue;
		}
		const existing = bestSurfaceByGroup.get(occurrence.surfaceGroupIndex);
		if (
			existing == null ||
			occurrence.start < existing.start ||
			(occurrence.start === existing.start && occurrence.end > existing.end)
		) {
			bestSurfaceByGroup.set(occurrence.surfaceGroupIndex, occurrence);
		}
	}
	return [...realOccurrences, ...bestSurfaceByGroup.values()].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
}

function mapOccurrencesToDisplayRanges(
	occurrences: readonly V3DirectSubitemOccurrence[],
	displayWindow: DisplayWindow,
): Array<{ start: number; end: number }> {
	return occurrences
		.map((occurrence) => ({
			start: Math.max(occurrence.start, displayWindow.start),
			end: Math.min(occurrence.end, displayWindow.end),
		}))
		.filter((range) => range.end > range.start)
		.map((range) => ({
			start: range.start - displayWindow.start,
			end: range.end - displayWindow.start,
		}));
}

function buildDisplayWindow(params: {
	snapshotText: string;
	lineInfos: readonly LineInfo[];
	candidate: V3DirectSubitemCandidate;
	maxChars: number;
}): DisplayWindow {
	const representativeOccurrences = pickRepresentativeOccurrences(
		params.candidate.displayOccurrences,
	);
	const lineOffsets = params.lineInfos.map((line) => line.start);
	const seedWindow = buildSeedLineWindow(lineOffsets, representativeOccurrences);
	if (seedWindow != null) {
		const seedLength = computeLineWindowLength(params.lineInfos, seedWindow);
		if (seedLength <= params.maxChars) {
			const expandedWindow = expandDisplayLineWindow({
				lineInfos: params.lineInfos,
				seedWindow,
				maxChars: params.maxChars,
			});
			return lineWindowToOffsets(
				params.lineInfos,
				trimBlankLineEdges(params.lineInfos, expandedWindow),
			);
		}
	}
	return buildInlineDisplayWindow({
		snapshotText: params.snapshotText,
		coverStart: representativeOccurrences[0]?.start ?? params.candidate.start,
		coverEnd:
			representativeOccurrences[representativeOccurrences.length - 1]?.end ??
			params.candidate.end,
		maxChars: params.maxChars,
	});
}

function pickRepresentativeOccurrences(
	occurrences: readonly V3DirectSubitemOccurrence[],
): V3DirectSubitemOccurrence[] {
	const bestByKey = new Map<string, V3DirectSubitemOccurrence>();
	for (const occurrence of occurrences) {
		const key =
			occurrence.kind === "surface_completion"
				? `surface:${occurrence.surfaceGroupIndex ?? -1}`
				: occurrence.kind === "residual_support"
					? `residual:${occurrence.surfaceGroupIndex ?? -1}:${occurrence.residualSupportKind ?? "none"}:${occurrence.start}:${occurrence.end}`
					: `unit:${occurrence.queryUnitIndex ?? -1}`;
		const existing = bestByKey.get(key);
		if (
			existing == null ||
			occurrence.start < existing.start ||
			(occurrence.start === existing.start && occurrence.end > existing.end)
		) {
			bestByKey.set(key, occurrence);
		}
	}
	return [...bestByKey.values()].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
}

function buildLineInfos(
	snapshotText: string,
	lineOffsets: readonly number[],
): LineInfo[] {
	return lineOffsets.map((start, index) => {
		const nextStart = lineOffsets[index + 1];
		const end = nextStart === undefined ? snapshotText.length : nextStart - 1;
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

function buildSeedLineWindow(
	lineOffsets: readonly number[],
	occurrences: readonly V3DirectSubitemOccurrence[],
): LineWindow | null {
	if (lineOffsets.length === 0 || occurrences.length === 0) {
		return null;
	}
	const startLine = Math.min(
		...occurrences.map((occurrence) =>
			offsetToLine(lineOffsets as number[], occurrence.start),
		),
	);
	const endLine = Math.max(
		...occurrences.map((occurrence) =>
			offsetToLine(
				lineOffsets as number[],
				Math.max(occurrence.start, occurrence.end - 1),
			),
		),
	);
	return { startLine, endLine };
}

function computeLineWindowLength(
	lineInfos: readonly LineInfo[],
	window: LineWindow,
): number {
	const start = lineInfos[window.startLine]?.start ?? 0;
	const end = lineInfos[window.endLine]?.end ?? start;
	return Math.max(0, end - start);
}

function expandDisplayLineWindow(params: {
	lineInfos: readonly LineInfo[];
	seedWindow: LineWindow;
	maxChars: number;
}): LineWindow {
	let startLine = params.seedWindow.startLine;
	let endLine = params.seedWindow.endLine;
	let upAdded = 0;
	let downAdded = 0;
	while (true) {
		let expanded = false;
		for (const direction of buildExpansionOrder({
			seedWindow: params.seedWindow,
			startLine,
			endLine,
		})) {
			if (direction === "up") {
				if (upAdded >= MAX_DISPLAY_LINES_PER_SIDE || startLine <= 0) {
					continue;
				}
				const candidate = { startLine: startLine - 1, endLine };
				if (
					computeLineWindowLength(params.lineInfos, candidate) >
					params.maxChars
				) {
					continue;
				}
				startLine -= 1;
				upAdded += 1;
				expanded = true;
				continue;
			}
			if (
				downAdded >= MAX_DISPLAY_LINES_PER_SIDE ||
				endLine >= params.lineInfos.length - 1
			) {
				continue;
			}
			const candidate = { startLine, endLine: endLine + 1 };
			if (
				computeLineWindowLength(params.lineInfos, candidate) >
				params.maxChars
			) {
				continue;
			}
			endLine += 1;
			downAdded += 1;
			expanded = true;
		}
		if (!expanded) {
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
	return {
		start: lineInfos[window.startLine]?.start ?? 0,
		end: lineInfos[window.endLine]?.end ?? 0,
	};
}

function buildInlineDisplayWindow(params: {
	snapshotText: string;
	coverStart: number;
	coverEnd: number;
	maxChars: number;
}): DisplayWindow {
	const coverLength = Math.max(1, params.coverEnd - params.coverStart);
	const remainingBudget = Math.max(0, params.maxChars - coverLength);
	const preBudget =
		coverLength <= 48 ? DISPLAY_PRE_CHARS_NARROW : DISPLAY_PRE_CHARS_WIDE;
	const postBudget =
		coverLength <= 48 ? DISPLAY_POST_CHARS_NARROW : DISPLAY_POST_CHARS_WIDE;
	const start = Math.max(
		0,
		params.coverStart - Math.min(preBudget, remainingBudget),
	);
	const end = Math.min(
		params.snapshotText.length,
		Math.max(
			params.coverEnd,
			start + params.maxChars,
			params.coverEnd + Math.min(postBudget, remainingBudget),
		),
	);
	return { start, end };
}

function mergeRanges(
	ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
	if (ranges.length === 0) {
		return [];
	}
	const sorted = [...ranges].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
	const merged = [{ ...sorted[0] }];
	for (const range of sorted.slice(1)) {
		const previous = merged[merged.length - 1];
		if (range.start <= previous.end) {
			previous.end = Math.max(previous.end, range.end);
			continue;
		}
		merged.push({ ...range });
	}
	return merged;
}

function renderHighlightedSnippet(
	text: string,
	ranges: ReadonlyArray<{ start: number; end: number }>,
): string {
	if (ranges.length === 0) {
		return text;
	}
	let html = "";
	let cursor = 0;
	for (const range of ranges) {
		if (cursor < range.start) {
			html += escapeHtml(text.slice(cursor, range.start));
		}
		html += `<span class="matched-line highlight-bg">${escapeHtml(text.slice(range.start, range.end))}</span>`;
		cursor = range.end;
	}
	if (cursor < text.length) {
		html += escapeHtml(text.slice(cursor));
	}
	return html;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
