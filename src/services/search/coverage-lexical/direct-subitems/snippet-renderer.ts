import { buildLineOffsets, offsetToLine } from "../../hybrid/chunker";
import type {
	DirectSubitemsCandidateSpan,
	DirectSubitemsRenderPayload,
} from "./contracts";

const ELLIPSIS = "\u2026";

export function renderDirectSubitemsCandidateSpan(params: {
	snapshotText: string;
	span: DirectSubitemsCandidateSpan;
}): DirectSubitemsRenderPayload {
	const { snapshotText, span } = params;
	const snippetText = snapshotText.slice(span.start, span.end);
	const prefixEllipsis = span.start > 0;
	const suffixEllipsis = span.end < snapshotText.length;
	const lineOffsets = buildLineOffsets(snapshotText);
	const row = offsetToLine(lineOffsets, span.anchorOffset);
	const lineStartOffset = lineOffsets[row] ?? 0;
	const col = Math.max(0, span.anchorOffset - lineStartOffset);
	const baseHighlightRanges = mergeRanges(
		span.occurrences.map((occurrence) => ({
			start: occurrence.start - span.start,
			end: occurrence.end - span.start,
		})),
	);
	const leadingOffset = prefixEllipsis ? ELLIPSIS.length : 0;
	const displayHighlightRanges = baseHighlightRanges.map((range) => ({
		start: range.start + leadingOffset,
		end: range.end + leadingOffset,
	}));
	const text = `${prefixEllipsis ? ELLIPSIS : ""}${snippetText}${suffixEllipsis ? ELLIPSIS : ""}`;
	return {
		text,
		html: renderHighlightedSnippet(snippetText, baseHighlightRanges, {
			prefixEllipsis,
			suffixEllipsis,
		}),
		snippetText: text,
		row,
		col,
		start: span.start,
		end: span.end,
		anchorOffset: span.anchorOffset,
		highlightRanges: displayHighlightRanges,
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
	options: {
		prefixEllipsis: boolean;
		suffixEllipsis: boolean;
	},
): string {
	if (ranges.length === 0) {
		return `${options.prefixEllipsis ? "&hellip;" : ""}${escapeHtml(snippetText)}${
			options.suffixEllipsis ? "&hellip;" : ""
		}`;
	}
	let rendered = options.prefixEllipsis ? "&hellip;" : "";
	let cursor = 0;
	for (const range of mergeRanges(ranges)) {
		rendered += escapeHtml(snippetText.slice(cursor, range.start));
		rendered += `<mark>${escapeHtml(snippetText.slice(range.start, range.end))}</mark>`;
		cursor = range.end;
	}
	rendered += escapeHtml(snippetText.slice(cursor));
	if (options.suffixEllipsis) {
		rendered += "&hellip;";
	}
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
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
