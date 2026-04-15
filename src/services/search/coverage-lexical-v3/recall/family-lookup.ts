import {
	getFamilySourceMask,
	isFamilyPrefixExpandable,
} from "../layout/family-lexicon";
import type { ResidentBase } from "../layout/types";
import type { V3QueryAnalysis } from "../query/analysis";
import { getFamilyText } from "./access";
import type {
	V3QueryFamilyMatch,
	V3QueryUnitFamilyMatches,
} from "./types";

const PREFIX_LOOKUP_BUDGET_MS = 50;
const PREFIX_LOOKUP_TIME_CHECK_INTERVAL = 256;

type PrefixLookupBudgetState = {
	startedAtMs: number;
	exhausted: boolean;
};

export function lookupQueryUnitFamilies(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
): V3QueryUnitFamilyMatches[] {
	const familyFlagsByFamilyId = base.familyLexicon.familyFlagsByFamilyId;
	const prefixBudgetState = createPrefixLookupBudgetState();
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
						familyFlagsByFamilyId,
					prefixBudgetState,
				),
	}));
}

function lookupSortedQueryUnitFamilyMatches(
	base: ResidentBase,
	queryUnitText: string,
	familyFlagsByFamilyId: Uint8Array,
	prefixBudgetState: PrefixLookupBudgetState,
): V3QueryFamilyMatch[] {
	const rangeStartFamilyId = findFirstFamilyIdAtOrAfter(base, queryUnitText);
	const exactMatch = collectExactMatch(
		base,
		rangeStartFamilyId,
		queryUnitText,
		familyFlagsByFamilyId,
	);
	const prefixMatches = collectBoundedPrefixMatches(
		base,
		rangeStartFamilyId,
		queryUnitText,
		familyFlagsByFamilyId,
		prefixBudgetState,
	);
	return exactMatch == null ? prefixMatches : [exactMatch, ...prefixMatches];
}

function collectExactMatch(
	base: ResidentBase,
	familyId: number,
	queryUnitText: string,
	familyFlagsByFamilyId: Uint8Array,
): V3QueryFamilyMatch | null {
	if (familyId >= base.familyLexicon.familyCount) {
		return null;
	}
	if (getFamilySourceMask(familyFlagsByFamilyId[familyId] ?? 0) === 0) {
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
	familyFlagsByFamilyId: Uint8Array,
	prefixBudgetState: PrefixLookupBudgetState,
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
		if (shouldAbortPrefixLookup(prefixBudgetState, scannedPrefixFamilyCount)) {
			break;
		}
		if (
			familyText === queryUnitText ||
			getFamilySourceMask(familyFlagsByFamilyId[familyId] ?? 0) === 0 ||
			!isFamilyPrefixExpandable(familyFlagsByFamilyId[familyId] ?? 0) ||
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
	switch (resolvePrefixLengthBand(queryUnitText.length)) {
		case 0:
			return 16;
		case 3:
			return 32;
		case 4:
			return 48;
		case 5:
			return 64;
		case 6:
			return 80;
		case 7:
			return 96;
		case 8:
			return 112;
		default:
			return 128;
	}
}

function computePrefixScanBudget(queryUnitText: string, matchLimit: number): number {
	switch (resolvePrefixLengthBand(queryUnitText.length)) {
		case 0:
			return Math.max(96, matchLimit * 6);
		case 3:
			return Math.max(256, matchLimit * 8);
		case 4:
			return Math.max(512, matchLimit * 10);
		case 5:
			return Math.max(1024, matchLimit * 16);
		case 6:
			return Math.max(2048, matchLimit * 26);
		case 7:
			return Math.max(4096, matchLimit * 42);
		case 8:
			return Math.max(6144, matchLimit * 55);
		default:
			return Math.max(8192, matchLimit * 64);
	}
}

function resolvePrefixLengthBand(queryUnitLength: number): 0 | 3 | 4 | 5 | 6 | 7 | 8 | 9 {
	if (queryUnitLength <= 2) {
		return 0;
	}
	if (queryUnitLength <= 8) {
		return queryUnitLength as 3 | 4 | 5 | 6 | 7 | 8;
	}
	return 9;
}

function createPrefixLookupBudgetState(): PrefixLookupBudgetState {
	return {
		startedAtMs: nowMs(),
		exhausted: false,
	};
}

function shouldAbortPrefixLookup(
	state: PrefixLookupBudgetState,
	scannedPrefixFamilyCount: number,
): boolean {
	if (state.exhausted) {
		return true;
	}
	if (scannedPrefixFamilyCount % PREFIX_LOOKUP_TIME_CHECK_INTERVAL !== 0) {
		return false;
	}
	if (nowMs() - state.startedAtMs <= PREFIX_LOOKUP_BUDGET_MS) {
		return false;
	}
	state.exhausted = true;
	return true;
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
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
