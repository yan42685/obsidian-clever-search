import type {
	DirectSubitemsOccurrence,
	DirectSubitemsQueryTermKind,
} from "./contracts";

const HAN_OCCURRENCE_NEIGHBOR_GAP = 2;
const HAN_OCCURRENCE_CHAIN_GAP = 0;

export function selectStructurallyRelevantExactOccurrences(
	exactOccurrences: readonly DirectSubitemsOccurrence[],
): DirectSubitemsOccurrence[] {
	const filtered = exactOccurrences.filter((occurrence) =>
		shouldKeepOccurrenceByHanProximity(occurrence, exactOccurrences),
	);
	return filtered.length > 0 ? [...filtered] : [...exactOccurrences];
}

export function filterDisplayEligibleOccurrences(
	occurrences: readonly DirectSubitemsOccurrence[],
): DirectSubitemsOccurrence[] {
	const filtered = occurrences.filter((occurrence) =>
		shouldKeepOccurrenceByHanProximity(occurrence, occurrences),
	);
	return filtered.length > 0 ? [...filtered] : [...occurrences];
}

export function shouldKeepOccurrenceByHanProximity(
	occurrence: DirectSubitemsOccurrence,
	occurrences: readonly DirectSubitemsOccurrence[],
): boolean {
	if (!isHanCharOccurrence(occurrence)) {
		return true;
	}
	return (
		hasNearbyNonHanOccurrence(occurrence, occurrences) ||
		hasAdjacentHanOccurrence(occurrence, occurrences)
	);
}

export function isHanCharOccurrence(
	occurrence: Pick<DirectSubitemsOccurrence, "termId">,
): boolean {
	return resolveOccurrenceTermKind(occurrence.termId) === "han_char";
}

function hasNearbyNonHanOccurrence(
	target: DirectSubitemsOccurrence,
	occurrences: readonly DirectSubitemsOccurrence[],
): boolean {
	return occurrences.some((candidate) => {
		if (areSameOccurrence(candidate, target)) {
			return false;
		}
		if (isHanCharOccurrence(candidate)) {
			return false;
		}
		return computeOccurrenceGap(candidate, target) <= HAN_OCCURRENCE_NEIGHBOR_GAP;
	});
}

function hasAdjacentHanOccurrence(
	target: DirectSubitemsOccurrence,
	occurrences: readonly DirectSubitemsOccurrence[],
): boolean {
	return occurrences.some((candidate) => {
		if (areSameOccurrence(candidate, target)) {
			return false;
		}
		if (!isHanCharOccurrence(candidate)) {
			return false;
		}
		return computeOccurrenceGap(candidate, target) <= HAN_OCCURRENCE_CHAIN_GAP;
	});
}

function areSameOccurrence(
	left: DirectSubitemsOccurrence,
	right: DirectSubitemsOccurrence,
): boolean {
	return (
		left.termId === right.termId &&
		left.tier === right.tier &&
		left.start === right.start &&
		left.end === right.end
	);
}

function computeOccurrenceGap(
	left: Pick<DirectSubitemsOccurrence, "start" | "end">,
	right: Pick<DirectSubitemsOccurrence, "start" | "end">,
): number {
	if (left.end <= right.start) {
		return right.start - left.end;
	}
	if (right.end <= left.start) {
		return left.start - right.end;
	}
	return 0;
}

function resolveOccurrenceTermKind(
	termId: string,
): DirectSubitemsQueryTermKind | null {
	const firstColon = termId.indexOf(":");
	if (firstColon < 0) {
		return null;
	}
	const secondColon = termId.indexOf(":", firstColon + 1);
	if (secondColon < 0) {
		return null;
	}
	const kind = termId.slice(firstColon + 1, secondColon);
	if (kind === "han_char" || kind === "non_han_run") {
		return kind;
	}
	return null;
}