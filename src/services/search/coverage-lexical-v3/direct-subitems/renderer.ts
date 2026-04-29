import { buildLineOffsets, offsetToLine } from "../../hybrid/chunker";
import type {
	V3DirectSubitemAtom,
	V3DirectSubitemCandidate,
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
	const { strongHighlightRanges, weakHighlightRanges } = resolveHighlightRanges(
		candidate,
		displayWindow,
	);
	return {
		text: snippetText,
		html: renderHighlightedSnippet(
			snippetText,
			strongHighlightRanges,
			weakHighlightRanges,
		),
		snippetText,
		row,
		col: Math.max(0, candidate.anchorOffset - lineStartOffset),
		coreStart: candidate.start,
		coreEnd: candidate.end,
		displayStart: displayWindow.start,
		displayEnd: displayWindow.end,
		anchorOffset: candidate.anchorOffset,
		highlightRanges: strongHighlightRanges,
		weakHighlightRanges,
	};
}

function resolveHighlightRanges(
	candidate: V3DirectSubitemCandidate,
	displayWindow: DisplayWindow,
): Readonly<{
	strongHighlightRanges: Array<{ start: number; end: number }>;
	weakHighlightRanges: Array<{ start: number; end: number }>;
}> {
	const displayAtoms = collapseSurfaceDisplayAtoms(
		candidate.displayAtoms,
	);
	const displayRanges = resolveStyledDisplayRanges(
		displayAtoms,
		displayWindow,
	);
	if (
		displayRanges.strongHighlightRanges.length > 0 ||
		displayRanges.weakHighlightRanges.length > 0
	) {
		return displayRanges;
	}
	return resolveStyledDisplayRanges(
		collapseSurfaceDisplayAtoms(candidate.atoms),
		displayWindow,
	);
}

function collapseSurfaceDisplayAtoms(
	atoms: readonly V3DirectSubitemAtom[],
): V3DirectSubitemAtom[] {
	const confirmedSurfaceGroups = new Set<number>();
	for (const atom of atoms) {
		if (
			atom.evidenceKind === "confirmed_surface" &&
			atom.surfaceGroupIndex != null
		) {
			confirmedSurfaceGroups.add(atom.surfaceGroupIndex);
		}
	}
	const displayAtoms = atoms.filter((atom) => {
		if (atom.evidenceKind === "confirmed_surface") {
			return false;
		}
		if (
			(atom.evidenceKind === "opaque_bigram" ||
				atom.evidenceKind === "matched_bigram") &&
			atom.surfaceGroupIndex != null &&
			confirmedSurfaceGroups.has(atom.surfaceGroupIndex)
		) {
			return false;
		}
		return true;
	});
	const bestSurfaceByGroup = new Map<number, V3DirectSubitemAtom>();
	for (const atom of atoms) {
		if (
			atom.evidenceKind !== "confirmed_surface" ||
			atom.surfaceGroupIndex == null
		) {
			continue;
		}
		const existing = bestSurfaceByGroup.get(atom.surfaceGroupIndex);
		if (
			existing == null ||
			atom.start < existing.start ||
			(atom.start === existing.start && atom.end > existing.end)
		) {
			bestSurfaceByGroup.set(atom.surfaceGroupIndex, atom);
		}
	}
	return [...displayAtoms, ...bestSurfaceByGroup.values()].sort(
		(left, right) => left.start - right.start || left.end - right.end,
	);
}

function resolveStyledDisplayRanges(
	atoms: readonly V3DirectSubitemAtom[],
	displayWindow: DisplayWindow,
): Readonly<{
	strongHighlightRanges: Array<{ start: number; end: number }>;
	weakHighlightRanges: Array<{ start: number; end: number }>;
}> {
	const strongHighlightRanges = mergeRanges(
		atoms
			.filter((atom) => atom.highlightTier !== "weak")
			.map((atom) => ({
				start: Math.max(atom.start, displayWindow.start),
				end: Math.min(atom.end, displayWindow.end),
			}))
			.filter((range) => range.end > range.start)
			.map((range) => ({
				start: range.start - displayWindow.start,
				end: range.end - displayWindow.start,
			})),
	);
	const weakHighlightRanges = mergeRanges(
		atoms
			.filter((atom) => atom.highlightTier === "weak")
			.map((atom) => ({
				start: Math.max(atom.start, displayWindow.start),
				end: Math.min(atom.end, displayWindow.end),
			}))
			.filter((range) => range.end > range.start)
			.map((range) => ({
				start: range.start - displayWindow.start,
				end: range.end - displayWindow.start,
			}))
			.filter(
				(range) =>
					!strongHighlightRanges.some(
						(strongRange) =>
							Math.min(strongRange.end, range.end) >
							Math.max(strongRange.start, range.start),
					),
			),
	);
	return {
		strongHighlightRanges,
		weakHighlightRanges,
	};
}

function buildDisplayWindow(params: {
	snapshotText: string;
	lineInfos: readonly LineInfo[];
	candidate: V3DirectSubitemCandidate;
	maxChars: number;
}): DisplayWindow {
	const representativeAtoms = pickRepresentativeAtoms(
		params.candidate.displayAtoms,
	);
	const lineOffsets = params.lineInfos.map((line) => line.start);
	const seedWindow = buildSeedLineWindow(lineOffsets, representativeAtoms);
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
		coverStart: representativeAtoms[0]?.start ?? params.candidate.start,
		coverEnd:
			representativeAtoms[representativeAtoms.length - 1]?.end ??
			params.candidate.end,
		maxChars: params.maxChars,
	});
}

function pickRepresentativeAtoms(
	atoms: readonly V3DirectSubitemAtom[],
): V3DirectSubitemAtom[] {
	const bestByKey = new Map<string, V3DirectSubitemAtom>();
	for (const atom of atoms) {
		const key =
			atom.kind === "confirmed_surface_atom"
				? `surface:${atom.surfaceGroupIndex ?? -1}`
				: atom.kind === "singleton_han_atom"
					? `singleton:${atom.surfaceGroupIndex ?? -1}:${atom.blockId}:${atom.matchedText}`
					: atom.kind === "matched_bigram_atom"
						? `matched:${atom.surfaceGroupIndex ?? -1}:${atom.bigramText ?? atom.matchedText}:${atom.blockId}`
					: atom.kind === "opaque_bigram_atom"
						? `opaque:${atom.surfaceGroupIndex ?? -1}:${atom.bigramText ?? atom.matchedText}`
						: `unit:${atom.queryUnitIndex ?? -1}`;
		const existing = bestByKey.get(key);
		if (
			existing == null ||
			atom.start < existing.start ||
			(atom.start === existing.start && atom.end > existing.end)
		) {
			bestByKey.set(key, atom);
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
	atoms: readonly V3DirectSubitemAtom[],
): LineWindow | null {
	if (lineOffsets.length === 0 || atoms.length === 0) {
		return null;
	}
	const startLine = Math.min(
		...atoms.map((atom) =>
			offsetToLine(lineOffsets as number[], atom.start),
		),
	);
	const endLine = Math.max(
		...atoms.map((atom) =>
			offsetToLine(
				lineOffsets as number[],
				Math.max(atom.start, atom.end - 1),
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
	const maxWindowLength = Math.max(params.maxChars, coverLength);
	const remainingBudget = Math.max(0, params.maxChars - coverLength);
	const preBudget =
		coverLength <= 48 ? DISPLAY_PRE_CHARS_NARROW : DISPLAY_PRE_CHARS_WIDE;
	const postBudget =
		coverLength <= 48 ? DISPLAY_POST_CHARS_NARROW : DISPLAY_POST_CHARS_WIDE;
	const preChars = Math.min(preBudget, remainingBudget, params.coverStart);
	const postChars = Math.min(
		postBudget,
		remainingBudget - preChars,
		params.snapshotText.length - params.coverEnd,
	);
	let start = params.coverStart - preChars;
	let end = params.coverEnd + postChars;
	let extraBudget = maxWindowLength - (end - start);
	if (extraBudget > 0) {
		const extraPostChars = Math.min(extraBudget, params.snapshotText.length - end);
		end += extraPostChars;
		extraBudget -= extraPostChars;
	}
	if (extraBudget > 0) {
		const extraPreChars = Math.min(extraBudget, start);
		start -= extraPreChars;
	}
	end = Math.min(
		params.snapshotText.length,
		Math.max(params.coverEnd, Math.min(end, start + maxWindowLength)),
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
	strongHighlightRanges: ReadonlyArray<{ start: number; end: number }>,
	weakHighlightRanges: ReadonlyArray<{ start: number; end: number }>,
): string {
	if (strongHighlightRanges.length === 0 && weakHighlightRanges.length === 0) {
		return escapeHtml(text);
	}
	const boundaries = new Set<number>([0, text.length]);
	for (const range of [...strongHighlightRanges, ...weakHighlightRanges]) {
		boundaries.add(range.start);
		boundaries.add(range.end);
	}
	const orderedBoundaries = [...boundaries].sort((left, right) => left - right);
	let html = "";
	for (let index = 1; index < orderedBoundaries.length; index += 1) {
		const start = orderedBoundaries[index - 1];
		const end = orderedBoundaries[index];
		if (end <= start) {
			continue;
		}
		const segmentText = escapeHtml(text.slice(start, end));
		const inStrong = strongHighlightRanges.some(
			(range) => range.start <= start && range.end >= end,
		);
		if (inStrong) {
			html += `<strong class="cs-search-match">${segmentText}</strong>`;
			continue;
		}
		const inWeak = weakHighlightRanges.some(
			(range) => range.start <= start && range.end >= end,
		);
		if (inWeak) {
			html += `<span class="cs-search-match-weak">${segmentText}</span>`;
			continue;
		}
		html += segmentText;
	}
	return html;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}
