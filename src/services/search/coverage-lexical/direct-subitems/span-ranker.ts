import type {
	DirectSubitemsCandidateSpan,
	DirectSubitemsOccurrence,
	DirectSubitemsScoreTuple,
} from "./contracts";

export function compareDirectSubitemsScoreTuples(
	left: DirectSubitemsScoreTuple,
	right: DirectSubitemsScoreTuple,
): number {
	if (left.coverageCount !== right.coverageCount) {
		return right.coverageCount - left.coverageCount;
	}
	if (left.exactCount !== right.exactCount) {
		return right.exactCount - left.exactCount;
	}
	const leftRawPhraseExactCount = left.rawPhraseExactCount ?? 0;
	const rightRawPhraseExactCount = right.rawPhraseExactCount ?? 0;
	if (leftRawPhraseExactCount !== rightRawPhraseExactCount) {
		return rightRawPhraseExactCount - leftRawPhraseExactCount;
	}
	const leftPhraseExactPairCount = left.phraseExactPairCount ?? 0;
	const rightPhraseExactPairCount = right.phraseExactPairCount ?? 0;
	if (leftPhraseExactPairCount !== rightPhraseExactPairCount) {
		return rightPhraseExactPairCount - leftPhraseExactPairCount;
	}
	const leftOrderedExactPairCount = left.orderedExactPairCount ?? 0;
	const rightOrderedExactPairCount = right.orderedExactPairCount ?? 0;
	if (leftOrderedExactPairCount !== rightOrderedExactPairCount) {
		return rightOrderedExactPairCount - leftOrderedExactPairCount;
	}
	if (left.prefixCount !== right.prefixCount) {
		return right.prefixCount - left.prefixCount;
	}
	if (left.fuzzyCount !== right.fuzzyCount) {
		return right.fuzzyCount - left.fuzzyCount;
	}
	if (left.distancePenaltyTotal !== right.distancePenaltyTotal) {
		return left.distancePenaltyTotal - right.distancePenaltyTotal;
	}
	if (left.distancePenaltyMax !== right.distancePenaltyMax) {
		return left.distancePenaltyMax - right.distancePenaltyMax;
	}
	if (left.spanLength !== right.spanLength) {
		return left.spanLength - right.spanLength;
	}
	if (left.anchorOffset !== right.anchorOffset) {
		return left.anchorOffset - right.anchorOffset;
	}
	return 0;
}

export function compareDirectSubitemsCandidateSpans(
	left: DirectSubitemsCandidateSpan,
	right: DirectSubitemsCandidateSpan,
): number {
	const leftSignature = String(left.termSignature ?? "");
	const rightSignature = String(right.termSignature ?? "");
	return (
		compareDirectSubitemsScoreTuples(left.score, right.score) ||
		left.start - right.start ||
		left.end - right.end ||
		leftSignature.localeCompare(rightSignature)
	);
}

export function rankDirectSubitemsCandidateSpans(
	spans: readonly DirectSubitemsCandidateSpan[],
): DirectSubitemsCandidateSpan[] {
	return [...spans].sort(compareDirectSubitemsCandidateSpans);
}

export function dedupeDirectSubitemsCandidateSpans(
	spans: readonly DirectSubitemsCandidateSpan[],
): DirectSubitemsCandidateSpan[] {
	const ranked = rankDirectSubitemsCandidateSpans(spans);
	const selected: DirectSubitemsCandidateSpan[] = [];
	for (const span of ranked) {
		if (selected.some((existing) => areEquivalentCandidateSpans(existing, span))) {
			continue;
		}
		selected.push(span);
	}
	return selected;
}

export function areEquivalentCandidateSpans(
	left: DirectSubitemsCandidateSpan,
	right: DirectSubitemsCandidateSpan,
): boolean {
	if (left.termSignature !== right.termSignature) {
		return false;
	}
	const overlapRatio = computeRangeOverlapRatio(left, right);
	if (overlapRatio < 0.85) {
		return false;
	}
	return buildOccurrenceSignature(left.occurrences) === buildOccurrenceSignature(right.occurrences);
}

function computeRangeOverlapRatio(
	left: Pick<DirectSubitemsCandidateSpan, "start" | "end">,
	right: Pick<DirectSubitemsCandidateSpan, "start" | "end">,
): number {
	const overlapStart = Math.max(left.start, right.start);
	const overlapEnd = Math.min(left.end, right.end);
	if (overlapEnd <= overlapStart) {
		return 0;
	}
	const overlap = overlapEnd - overlapStart;
	const base = Math.max(1, Math.min(left.end - left.start, right.end - right.start));
	return overlap / base;
}

function buildOccurrenceSignature(
	occurrences: readonly DirectSubitemsOccurrence[],
): string {
	return occurrences
		.map((occurrence) => `${occurrence.termId}:${occurrence.start}:${occurrence.end}:${occurrence.tier}`)
		.join("|");
}