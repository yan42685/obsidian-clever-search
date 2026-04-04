import type {
	HybridLexicalLaneDisplayCandidate,
	HybridLexicalLaneRankedBlockCandidate,
} from "./contracts";

export type HybridLexicalLaneDisplayMergeMode = "suppress" | "trim-overlap";

export function mergeHybridLexicalLaneRankedBlocks(
	candidates: readonly HybridLexicalLaneRankedBlockCandidate[],
	maxResults: number,
): HybridLexicalLaneRankedBlockCandidate[] {
	const selected: HybridLexicalLaneRankedBlockCandidate[] = [];
	for (const candidate of candidates) {
		if (
			selected.some((existing) =>
				shouldSuppressRankedBlockCandidate(candidate, existing),
			)
		) {
			continue;
		}
		selected.push(candidate);
		if (selected.length >= maxResults) {
			break;
		}
	}
	return selected;
}

export function mergeHybridLexicalLaneDisplayCandidates(
	candidates: readonly HybridLexicalLaneDisplayCandidate[],
	maxResults: number,
	options?: {
		mode?: HybridLexicalLaneDisplayMergeMode;
	},
): HybridLexicalLaneDisplayCandidate[] {
	const mode = options?.mode ?? "suppress";
	const selected: HybridLexicalLaneDisplayCandidate[] = [];
	for (const candidate of candidates) {
		const mergedCandidate =
			mode === "trim-overlap"
				? mergeDisplayCandidateWithTrimOverlap(candidate, selected)
				: shouldSuppressAgainstSelected(candidate, selected)
					? null
					: candidate;
		if (!mergedCandidate) {
			continue;
		}
		selected.push(mergedCandidate);
		if (selected.length >= maxResults) {
			break;
		}
	}
	return selected;
}

function shouldSuppressRankedBlockCandidate(
	candidate: HybridLexicalLaneRankedBlockCandidate,
	existing: HybridLexicalLaneRankedBlockCandidate,
): boolean {
	if (candidate.filePath !== existing.filePath) {
		return false;
	}
	const overlapRatio = computeBlockOverlapRatio(candidate, existing);
	const noveltyRatio = computeRankedBlockNoveltyRatio(candidate, existing);
	if (overlapRatio >= 0.9 && noveltyRatio < 0.2) {
		return true;
	}
	if (overlapRatio >= 0.8 && noveltyRatio < 0.12) {
		return true;
	}
	if (
		candidate.headingChain.join("\u001f") ===
			existing.headingChain.join("\u001f") &&
		Math.abs(candidate.localSignals.anchorOffset - existing.localSignals.anchorOffset) <
			96 &&
		noveltyRatio < 0.28
	) {
		return true;
	}
	return false;
}

function shouldSuppressDisplayCandidate(
	candidate: HybridLexicalLaneDisplayCandidate,
	existing: HybridLexicalLaneDisplayCandidate,
): boolean {
	if (candidate.filePath !== existing.filePath) {
		return false;
	}
	const overlapRatio = computeDisplayBodyOverlapRatio(candidate, existing);
	const noveltyRatio = computeDisplayBodyNoveltyRatio(candidate, existing);
	if (overlapRatio >= 0.9 && noveltyRatio < 0.2) {
		return true;
	}
	if (
		candidate.segmentText === existing.segmentText &&
		Math.abs(candidate.anchorOffset - existing.anchorOffset) < 96 &&
		noveltyRatio < 0.24
	) {
		return true;
	}
	return overlapRatio >= 0.82 && noveltyRatio < 0.08;
}

function shouldSuppressAgainstSelected(
	candidate: HybridLexicalLaneDisplayCandidate,
	selected: readonly HybridLexicalLaneDisplayCandidate[],
): boolean {
	return selected.some((existing) =>
		shouldSuppressDisplayCandidate(candidate, existing),
	);
}

function mergeDisplayCandidateWithTrimOverlap(
	candidate: HybridLexicalLaneDisplayCandidate,
	selected: readonly HybridLexicalLaneDisplayCandidate[],
): HybridLexicalLaneDisplayCandidate | null {
	let nextCandidate = candidate;
	for (const existing of selected) {
		if (nextCandidate.filePath !== existing.filePath) {
			continue;
		}
		if (!shouldSuppressDisplayCandidate(nextCandidate, existing)) {
			continue;
		}
		const trimmedCandidate = trimDisplayCandidateOverlap(nextCandidate, existing);
		if (trimmedCandidate === null) {
			return null;
		}
		nextCandidate = trimmedCandidate;
	}
	return nextCandidate;
}

function trimDisplayCandidateOverlap(
	candidate: HybridLexicalLaneDisplayCandidate,
	existing: HybridLexicalLaneDisplayCandidate,
): HybridLexicalLaneDisplayCandidate | null {
	const overlapStart = Math.max(candidate.bodyStart, existing.bodyStart);
	const overlapEnd = Math.min(candidate.bodyEnd, existing.bodyEnd);
	if (overlapEnd <= overlapStart) {
		return candidate;
	}
	const anchorOffset = candidate.anchorOffset;
	if (anchorOffset <= overlapStart) {
		return trimDisplayCandidateToBodyWindow(candidate, candidate.bodyStart, overlapStart);
	}
	if (anchorOffset >= overlapEnd) {
		return trimDisplayCandidateToBodyWindow(candidate, overlapEnd, candidate.bodyEnd);
	}
	return null;
}

function trimDisplayCandidateToBodyWindow(
	candidate: HybridLexicalLaneDisplayCandidate,
	nextBodyStart: number,
	nextBodyEnd: number,
): HybridLexicalLaneDisplayCandidate | null {
	const clampedStart = Math.max(candidate.bodyStart, nextBodyStart);
	const clampedEnd = Math.min(candidate.bodyEnd, nextBodyEnd);
	if (clampedEnd <= clampedStart) {
		return null;
	}
	if (candidate.anchorOffset < clampedStart || candidate.anchorOffset > clampedEnd) {
		return null;
	}
	const originalBodyLength = Math.max(1, candidate.bodyEnd - candidate.bodyStart);
	const trimmedBodyLength = clampedEnd - clampedStart;
	if (trimmedBodyLength < Math.min(48, originalBodyLength * 0.25)) {
		return null;
	}

	const nextBodyHighlightRanges = candidate.bodyHighlightRanges
		.map((range) => ({
			start: Math.max(candidate.bodyStart + range.start, clampedStart),
			end: Math.min(candidate.bodyStart + range.end, clampedEnd),
		}))
		.filter((range) => range.end > range.start)
		.map((range) => ({
			start: range.start - clampedStart,
			end: range.end - clampedStart,
		}));
	if (nextBodyHighlightRanges.length === 0) {
		return null;
	}

	const bodyOffsetStart = clampedStart - candidate.bodyStart;
	const bodyOffsetEnd = clampedEnd - candidate.bodyStart;
	const bodyText = candidate.bodyText.slice(bodyOffsetStart, bodyOffsetEnd);
	if (bodyText.trim().length === 0) {
		return null;
	}
	const headerPrefix = candidate.headerText ? `${candidate.headerText}\n\n` : "";
	const highlightOffset = headerPrefix.length;
	const highlightRanges = nextBodyHighlightRanges.map((range) => ({
		start: highlightOffset + range.start,
		end: highlightOffset + range.end,
	}));
	return {
		...candidate,
		snippetText: headerPrefix ? `${headerPrefix}${bodyText}` : bodyText,
		snippetHtml: renderDisplayCandidateHtml(
			headerPrefix,
			bodyText,
			nextBodyHighlightRanges,
		),
		bodyText,
		highlightRanges,
		bodyHighlightRanges: nextBodyHighlightRanges,
		displayStart: clampedStart,
		displayEnd: clampedEnd,
		bodyStart: clampedStart,
		bodyEnd: clampedEnd,
	};
}

function computeRankedBlockNoveltyRatio(
	candidate: Pick<HybridLexicalLaneRankedBlockCandidate, "matchOccurrences">,
	existing: Pick<HybridLexicalLaneRankedBlockCandidate, "matchOccurrences">,
): number {
	if (candidate.matchOccurrences.length === 0) {
		return 0;
	}
	let novelCount = 0;
	for (const occurrence of candidate.matchOccurrences) {
		const overlapsExisting = existing.matchOccurrences.some(
			(previous) =>
				previous.termId === occurrence.termId &&
				Math.min(previous.end, occurrence.end) >
					Math.max(previous.start, occurrence.start),
		);
		if (!overlapsExisting) {
			novelCount += 1;
		}
	}
	return novelCount / candidate.matchOccurrences.length;
}

function computeDisplayBodyNoveltyRatio(
	candidate: Pick<HybridLexicalLaneDisplayCandidate, "bodyHighlightRanges">,
	existing: Pick<HybridLexicalLaneDisplayCandidate, "bodyHighlightRanges">,
): number {
	if (candidate.bodyHighlightRanges.length === 0) {
		return 0;
	}
	let novelCount = 0;
	for (const range of candidate.bodyHighlightRanges) {
		const overlapsExisting = existing.bodyHighlightRanges.some(
			(previous) =>
				Math.min(previous.end, range.end) > Math.max(previous.start, range.start),
		);
		if (!overlapsExisting) {
			novelCount += 1;
		}
	}
	return novelCount / candidate.bodyHighlightRanges.length;
}

function computeBlockOverlapRatio(
	left: Pick<HybridLexicalLaneRankedBlockCandidate, "startOffset" | "endOffset">,
	right: Pick<HybridLexicalLaneRankedBlockCandidate, "startOffset" | "endOffset">,
): number {
	return computeOffsetOverlapRatio(
		left.startOffset,
		left.endOffset,
		right.startOffset,
		right.endOffset,
	);
}

function computeDisplayBodyOverlapRatio(
	left: Pick<HybridLexicalLaneDisplayCandidate, "bodyStart" | "bodyEnd">,
	right: Pick<HybridLexicalLaneDisplayCandidate, "bodyStart" | "bodyEnd">,
): number {
	return computeOffsetOverlapRatio(
		left.bodyStart,
		left.bodyEnd,
		right.bodyStart,
		right.bodyEnd,
	);
}

function computeOffsetOverlapRatio(
	leftStart: number,
	leftEnd: number,
	rightStart: number,
	rightEnd: number,
): number {
	const overlapStart = Math.max(leftStart, rightStart);
	const overlapEnd = Math.min(leftEnd, rightEnd);
	if (overlapEnd <= overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart;
	const shorterLength = Math.max(
		1,
		Math.min(leftEnd - leftStart, rightEnd - rightStart),
	);
	return overlap / shorterLength;
}

function renderDisplayCandidateHtml(
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
