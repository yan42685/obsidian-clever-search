import type { ResidentBase } from "../layout/types";
import type { V3QueryAnalysis } from "../query/analysis";
import { getFamilyText } from "./access";
import type {
	V3QueryFamilyMatch,
	V3QueryUnitFamilyMatches,
} from "./types";

export function lookupQueryUnitFamilies(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
): V3QueryUnitFamilyMatches[] {
	const prefixExpandableByFamilyId = base.familyLexicon.prefixExpandableByFamilyId;
	const sourceMaskByFamilyId = base.familyLexicon.sourceMaskByFamilyId;
	return queryAnalysis.primaryUnits.map((queryUnit) => ({
		queryUnitIndex: queryUnit.index,
		queryUnitText: queryUnit.text,
		queryUnitSource: queryUnit.source,
		querySurfaceGroupIndex: queryUnit.surfaceGroupIndex,
		matches:
			queryUnit.source === "opaque_han_confirmed"
				? []
				: lookupSortedQueryUnitFamilyMatches(
						base,
						queryUnit.text,
						prefixExpandableByFamilyId,
						sourceMaskByFamilyId,
					),
	}));
}

function lookupSortedQueryUnitFamilyMatches(
	base: ResidentBase,
	queryUnitText: string,
	prefixExpandableByFamilyId: Uint8Array,
	sourceMaskByFamilyId: Uint8Array,
): V3QueryFamilyMatch[] {
	const rangeStartFamilyId = findFirstFamilyIdAtOrAfter(base, queryUnitText);
	const exactMatch = collectExactMatch(
		base,
		rangeStartFamilyId,
		queryUnitText,
		sourceMaskByFamilyId,
	);
	const prefixMatches = collectBoundedPrefixMatches(
		base,
		rangeStartFamilyId,
		queryUnitText,
		prefixExpandableByFamilyId,
		sourceMaskByFamilyId,
	);
	return exactMatch == null ? prefixMatches : [exactMatch, ...prefixMatches];
}

function collectExactMatch(
	base: ResidentBase,
	familyId: number,
	queryUnitText: string,
	sourceMaskByFamilyId: Uint8Array,
): V3QueryFamilyMatch | null {
	if (familyId >= base.familyLexicon.familyCount) {
		return null;
	}
	if ((sourceMaskByFamilyId[familyId] ?? 0) === 0) {
		return null;
	}
	const familyText = getFamilyText(base, familyId);
	if (familyText !== queryUnitText) {
		return null;
	}
	return {
		familyId,
		familyText,
		matchKind: "exact",
	};
}

function collectBoundedPrefixMatches(
	base: ResidentBase,
	rangeStartFamilyId: number,
	queryUnitText: string,
	prefixExpandableByFamilyId: Uint8Array,
	sourceMaskByFamilyId: Uint8Array,
): V3QueryFamilyMatch[] {
	const matchLimit = computePrefixMatchLimit(queryUnitText);
	if (matchLimit <= 0) {
		return [];
	}
	const scanBudget = computePrefixScanBudget(queryUnitText, matchLimit);
	const matches: V3QueryFamilyMatch[] = [];
	let scannedPrefixFamilyCount = 0;
	for (
		let familyId = rangeStartFamilyId;
		familyId < base.familyLexicon.familyCount;
		familyId += 1
	) {
		const familyText = getFamilyText(base, familyId);
		if (!familyText.startsWith(queryUnitText)) {
			break;
		}
		scannedPrefixFamilyCount += 1;
		if (scannedPrefixFamilyCount > scanBudget) {
			break;
		}
		if (
			familyText === queryUnitText ||
			(sourceMaskByFamilyId[familyId] ?? 0) === 0 ||
			prefixExpandableByFamilyId[familyId] !== 1 ||
			familyText.length <= queryUnitText.length
		) {
			continue;
		}
		insertBoundedPrefixMatch(
			matches,
			{
				familyId,
				familyText,
				matchKind: "prefix",
			},
			queryUnitText,
			matchLimit,
		);
	}
	return matches;
}

function insertBoundedPrefixMatch(
	matches: V3QueryFamilyMatch[],
	match: V3QueryFamilyMatch,
	queryUnitText: string,
	matchLimit: number,
): void {
	let insertAt = 0;
	while (
		insertAt < matches.length &&
		compareQueryFamilyMatch(matches[insertAt], match, queryUnitText) <= 0
	) {
		insertAt += 1;
	}
	if (insertAt >= matchLimit) {
		return;
	}
	matches.splice(insertAt, 0, match);
	if (matches.length > matchLimit) {
		matches.pop();
	}
}

function findFirstFamilyIdAtOrAfter(
	base: ResidentBase,
	queryUnitText: string,
): number {
	let low = 0;
	let high = base.familyLexicon.familyCount;
	while (low < high) {
		const middle = low + ((high - low) >> 1);
		const comparison = getFamilyText(base, middle).localeCompare(queryUnitText);
		if (comparison < 0) {
			low = middle + 1;
			continue;
		}
		high = middle;
	}
	return low;
}

function computePrefixMatchLimit(queryUnitText: string): number {
	if (queryUnitText.length <= 2) {
		return 16;
	}
	if (queryUnitText.length <= 4) {
		return 32;
	}
	if (queryUnitText.length <= 7) {
		return 64;
	}
	return 96;
}

function computePrefixScanBudget(queryUnitText: string, matchLimit: number): number {
	if (queryUnitText.length <= 2) {
		return Math.max(32, matchLimit * 3);
	}
	if (queryUnitText.length <= 4) {
		return Math.max(96, matchLimit * 3);
	}
	if (queryUnitText.length <= 7) {
		return Math.max(192, matchLimit * 4);
	}
	return Math.max(256, matchLimit * 4);
}

function compareQueryFamilyMatch(
	left: V3QueryFamilyMatch,
	right: V3QueryFamilyMatch,
	queryUnitText: string,
): number {
	if (left.matchKind !== right.matchKind) {
		return left.matchKind === "exact" ? -1 : 1;
	}
	const leftExpansion = left.familyText.length - queryUnitText.length;
	const rightExpansion = right.familyText.length - queryUnitText.length;
	if (leftExpansion !== rightExpansion) {
		return leftExpansion - rightExpansion;
	}
	const leftCompoundPenalty = getCompoundPrefixPenalty(left);
	const rightCompoundPenalty = getCompoundPrefixPenalty(right);
	if (leftCompoundPenalty !== rightCompoundPenalty) {
		return leftCompoundPenalty - rightCompoundPenalty;
	}
	return left.familyText.localeCompare(right.familyText);
}

function getCompoundPrefixPenalty(match: V3QueryFamilyMatch): number {
	return match.matchKind === "prefix" && /[_./-]/u.test(match.familyText) ? 1 : 0;
}
