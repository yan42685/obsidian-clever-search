import { buildLineOffsets, offsetToLine } from "../../hybrid/chunker";
import { LangUtil } from "src/utils/lang-util";
import type {
	DirectSubitemsCandidateSpan,
	DirectSubitemsRenderPayload,
} from "./contracts";

const DISPLAY_PRE_CHARS_WIDE = 60;
const DISPLAY_POST_CHARS_WIDE = 80;
const DISPLAY_PRE_CHARS_NARROW = 180;
const DISPLAY_POST_CHARS_NARROW = 200;

export function renderDirectSubitemsCandidateSpan(params: {
	snapshotText: string;
	span: DirectSubitemsCandidateSpan;
}): DirectSubitemsRenderPayload {
	const { snapshotText, span } = params;
	const displayWindow = expandDisplayWindow(snapshotText, span);
	const snippetText = snapshotText.slice(displayWindow.start, displayWindow.end);
	const lineOffsets = buildLineOffsets(snapshotText);
	const row = offsetToLine(lineOffsets, span.anchorOffset);
	const lineStartOffset = lineOffsets[row] ?? 0;
	const col = Math.max(0, span.anchorOffset - lineStartOffset);
	const baseHighlightRanges = mergeRanges(
		span.occurrences.map((occurrence) => ({
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
		start: displayWindow.start,
		end: displayWindow.end,
		anchorOffset: span.anchorOffset,
		highlightRanges: baseHighlightRanges,
	};
}

export function renderDirectSubitemsCandidateSpans(params: {
	snapshotText: string;
	spans: readonly DirectSubitemsCandidateSpan[];
}): DirectSubitemsRenderPayload[] {
	return params.spans.map((span) =>
		renderDirectSubitemsCandidateSpan({
			snapshotText: params.snapshotText,
			span,
		}),
	);
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

function expandDisplayWindow(
	snapshotText: string,
	span: Pick<DirectSubitemsCandidateSpan, "start" | "end">,
): { start: number; end: number } {
	const coreText = snapshotText.slice(span.start, span.end);
	const isWideCharContext = LangUtil.testWideChar(coreText);
	const preChars = isWideCharContext
		? DISPLAY_PRE_CHARS_WIDE
		: DISPLAY_PRE_CHARS_NARROW;
	const postChars = isWideCharContext
		? DISPLAY_POST_CHARS_WIDE
		: DISPLAY_POST_CHARS_NARROW;
	const expandedStart = Math.max(0, span.start - preChars);
	const expandedEnd = Math.min(snapshotText.length, span.end + postChars);
	const lineStart = findLineStart(snapshotText, span.start);
	const lineEnd = findLineEnd(snapshotText, Math.max(span.start, span.end - 1));
	return {
		start: Math.max(expandedStart, lineStart),
		end: Math.min(expandedEnd, lineEnd),
	};
}

function findLineStart(text: string, offset: number): number {
	const index = text.lastIndexOf("\n", Math.max(0, offset - 1));
	return index < 0 ? 0 : index + 1;
}

function findLineEnd(text: string, offset: number): number {
	const index = text.indexOf("\n", Math.max(0, offset));
	return index < 0 ? text.length : index;
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
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
