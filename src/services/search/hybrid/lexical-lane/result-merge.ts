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
	if (computeBlockOverlapRatio(candidate, existing) >= 0.82) {
		return true;
	}
	if (
		candidate.headingChain.join("\u001f") ===
			existing.headingChain.join("\u001f") &&
		Math.abs(candidate.localSignals.anchorOffset - existing.localSignals.anchorOffset) <
			120
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
	if (computeDisplayOverlapRatio(candidate, existing) >= 0.78) {
		return true;
	}
	if (
		candidate.segmentText === existing.segmentText &&
		Math.abs(candidate.anchorOffset - existing.anchorOffset) < 120
	) {
		return true;
	}
	return false;
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
