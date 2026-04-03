import { estimateTokenCount } from "../chunker";
import type {
	HybridLexicalLaneBlockCandidate,
	HybridLexicalLaneRankedBlockCandidate,
} from "../lexical-lane/contracts";
import type { HybridSharedSnippetPayload } from "./contracts";
import { buildHybridSharedSnippetHeader } from "./context-header";
import {
	HYBRID_SHARED_SNIPPET_MAX_TOKENS,
	HYBRID_SHARED_SNIPPET_MIN_BODY_TOKENS,
} from "./token-budget";
import { buildHybridSharedSnippetBodyWindow } from "./window-builder";

export function buildHybridSharedSnippet(params: {
	snapshotText: string;
	candidate: HybridLexicalLaneBlockCandidate | HybridLexicalLaneRankedBlockCandidate;
	maxChars: number;
}): HybridSharedSnippetPayload {
	const { snapshotText, candidate } = params;
	if (candidate.bridgePreviewText) {
		const previewLength = candidate.bridgePreviewText.length;
		return {
			snippetText: candidate.bridgePreviewText,
			snippetHtml: candidate.bridgePreviewText,
			highlightRanges:
				candidate.bridgePreviewRanges?.map((range) => ({ ...range })) ?? [],
			bodyHighlightRanges:
				candidate.bridgePreviewRanges?.map((range) => ({ ...range })) ?? [],
			coreStart: 0,
			coreEnd: previewLength,
			displayStart: 0,
			displayEnd: previewLength,
			bodyStart: 0,
			bodyEnd: previewLength,
			anchorOffset: candidate.localSignals.anchorOffset,
			headerText: "",
			bodyText: candidate.bridgePreviewText,
		};
	}

	const headerText = buildHybridSharedSnippetHeader({
		filePath: candidate.filePath,
		snapshotText,
		startLine: candidate.startLine,
	});
	const bodyBudget = Math.max(
		HYBRID_SHARED_SNIPPET_MIN_BODY_TOKENS,
		HYBRID_SHARED_SNIPPET_MAX_TOKENS - estimateTokenCount(headerText),
	);
	const bodyWindow = buildHybridSharedSnippetBodyWindow({
		snapshotText,
		candidate,
		bodyBudget,
	});
	const bodyText = snapshotText.slice(bodyWindow.start, bodyWindow.end);
	const headerPrefix = headerText ? `${headerText}\n\n` : "";
	const headerLength = headerPrefix.length;
	const bodyHighlightRanges = mergeRanges(
		candidate.matchOccurrences
			.filter(
				(occurrence) =>
					occurrence.start < bodyWindow.end && occurrence.end > bodyWindow.start,
			)
			.map((occurrence) => ({
				start: Math.max(occurrence.start, bodyWindow.start) - bodyWindow.start,
				end: Math.min(occurrence.end, bodyWindow.end) - bodyWindow.start,
			})),
	);
	const highlightRanges = bodyHighlightRanges.map((range) => ({
		start: headerLength + range.start,
		end: headerLength + range.end,
	}));
	return {
		snippetText: headerPrefix ? `${headerPrefix}${bodyText}` : bodyText,
		snippetHtml: renderSnippetHtml(headerPrefix, bodyText, bodyHighlightRanges),
		highlightRanges,
		bodyHighlightRanges,
		coreStart: candidate.startOffset,
		coreEnd: candidate.endOffset,
		displayStart: bodyWindow.start,
		displayEnd: bodyWindow.end,
		bodyStart: bodyWindow.start,
		bodyEnd: bodyWindow.end,
		anchorOffset: candidate.localSignals.anchorOffset,
		headerText,
		bodyText,
	};
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

function renderSnippetHtml(
	headerPrefix: string,
	bodyText: string,
	highlightRanges: ReadonlyArray<{ start: number; end: number }>,
): string {
	return `${escapeHtml(headerPrefix)}${renderHighlightedBody(bodyText, highlightRanges)}`;
}

function renderHighlightedBody(
	bodyText: string,
	highlightRanges: ReadonlyArray<{ start: number; end: number }>,
): string {
	if (highlightRanges.length === 0) {
		return escapeHtml(bodyText);
	}
	let rendered = "";
	let cursor = 0;
	for (const range of mergeRanges(highlightRanges)) {
		rendered += escapeHtml(bodyText.slice(cursor, range.start));
		rendered += `<mark>${escapeHtml(bodyText.slice(range.start, range.end))}</mark>`;
		cursor = range.end;
	}
	rendered += escapeHtml(bodyText.slice(cursor));
	return rendered;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
