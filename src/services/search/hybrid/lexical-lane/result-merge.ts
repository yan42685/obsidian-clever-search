import type {
	HybridLexicalLaneDisplayCandidate,
	HybridLexicalLaneRankedBlockCandidate,
} from "./contracts";

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
): HybridLexicalLaneDisplayCandidate[] {
	const selected: HybridLexicalLaneDisplayCandidate[] = [];
	for (const candidate of candidates) {
		if (
			selected.some((existing) =>
				shouldSuppressDisplayCandidate(candidate, existing),
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
	const overlapRatio = computeDisplayOverlapRatio(candidate, existing);
	const noveltyRatio = computeDisplayNoveltyRatio(candidate, existing);
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

function computeDisplayNoveltyRatio(
	candidate: Pick<HybridLexicalLaneDisplayCandidate, "highlightRanges">,
	existing: Pick<HybridLexicalLaneDisplayCandidate, "highlightRanges">,
): number {
	if (candidate.highlightRanges.length === 0) {
		return 0;
	}
	let novelCount = 0;
	for (const range of candidate.highlightRanges) {
		const overlapsExisting = existing.highlightRanges.some(
			(previous) =>
				Math.min(previous.end, range.end) > Math.max(previous.start, range.start),
		);
		if (!overlapsExisting) {
			novelCount += 1;
		}
	}
	return novelCount / candidate.highlightRanges.length;
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

function computeDisplayOverlapRatio(
	left: Pick<HybridLexicalLaneDisplayCandidate, "displayStart" | "displayEnd">,
	right: Pick<HybridLexicalLaneDisplayCandidate, "displayStart" | "displayEnd">,
): number {
	return computeOffsetOverlapRatio(
		left.displayStart,
		left.displayEnd,
		right.displayStart,
		right.displayEnd,
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
	const shorterLength = Math.max(1, Math.min(leftEnd - leftStart, rightEnd - rightStart));
	return overlap / shorterLength;
}
