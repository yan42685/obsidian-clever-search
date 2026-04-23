import {
	getFamilySourceMask,
	isFamilyPrefixExpandable,
} from "../layout/family-lexicon";
import {
	buildFuzzyLookupKeys,
	FUZZY_RESCUE_MIN_QUERY_LENGTH,
} from "../layout/fuzzy-rescue";
import type { ResidentBase, ResidentFuzzyRescueSidecar } from "../layout/types";
import type { V3QueryAnalysis, V3QueryUnit } from "../query/analysis";
import {
	getFamilyIdForShardLocalFamilySlot,
	getFamilyText,
	getShardLocalFamilySlot,
	getShardLocalFamilyText,
} from "./access";
import type {
	V3QueryFamilyMatch,
	V3QueryUnitFamilyMatches,
} from "./types";

export type V3FamilyLookupOptions = Readonly<{
	allowPrefixMatch?: boolean;
	allowFuzzyMatch?: boolean;
}>;

const PREFIX_LOOKUP_BUDGET_MS = 50;
const PREFIX_LOOKUP_TIME_CHECK_INTERVAL = 256;
const FUZZY_LOOKUP_BUDGET_MS = 8;
const FUZZY_LOOKUP_TIME_CHECK_INTERVAL = 16;
const FUZZY_LOOKUP_MAX_VERIFIED_CANDIDATES = 64;
const FUZZY_LOOKUP_MATCH_LIMIT = 8;

type PrefixLookupBudgetState = {
	startedAtMs: number;
	exhausted: boolean;
};

type FuzzyLookupBudgetState = {
	startedAtMs: number;
	exhausted: boolean;
};

export function lookupQueryUnitFamilies(
	base: ResidentBase,
	queryAnalysis: V3QueryAnalysis,
	options: V3FamilyLookupOptions = {},
	fuzzyRescueSidecar: ResidentFuzzyRescueSidecar = base.fuzzyRescue,
): V3QueryUnitFamilyMatches[] {
	const familyFlagsByFamilyId = base.familyLexicon.familyFlagsByFamilyId;
	const prefixBudgetState = createPrefixLookupBudgetState();
	const fuzzyBudgetState = createFuzzyLookupBudgetState();
	const allowPrefixMatch = options.allowPrefixMatch !== false;
	const allowFuzzyMatch = options.allowFuzzyMatch !== false;
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
						queryUnit,
						queryAnalysis,
						familyFlagsByFamilyId,
						fuzzyRescueSidecar,
						prefixBudgetState,
						fuzzyBudgetState,
						allowPrefixMatch,
						allowFuzzyMatch,
				),
	}));
}

function lookupSortedQueryUnitFamilyMatches(
	base: ResidentBase,
	queryUnit: V3QueryUnit,
	queryAnalysis: V3QueryAnalysis,
	familyFlagsByFamilyId: Uint8Array,
	fuzzyRescueSidecar: ResidentFuzzyRescueSidecar,
	prefixBudgetState: PrefixLookupBudgetState,
	fuzzyBudgetState: FuzzyLookupBudgetState,
	allowPrefixMatch: boolean,
	allowFuzzyMatch: boolean,
): V3QueryFamilyMatch[] {
	const queryUnitText = queryUnit.text;
	const rangeStartShardLocalFamilySlot = findFirstShardLocalFamilySlotAtOrAfter(
		base,
		queryUnitText,
	);
	const exactMatch = collectExactMatch(
		base,
		rangeStartShardLocalFamilySlot,
		queryUnitText,
		familyFlagsByFamilyId,
	);
	const prefixMatches = allowPrefixMatch
		? collectBoundedPrefixMatches(
				base,
				rangeStartShardLocalFamilySlot,
				queryUnitText,
				familyFlagsByFamilyId,
				prefixBudgetState,
		  )
		: [];
	if (exactMatch != null) {
		return [exactMatch, ...prefixMatches];
	}
	if (prefixMatches.length > 0) {
		return prefixMatches;
	}
	if (!allowFuzzyMatch || !shouldAttemptFuzzyRescue(queryUnit, queryAnalysis)) {
		return [];
	}
	return collectBoundedFuzzyMatches(
		base,
		queryUnitText,
		fuzzyBudgetState,
		fuzzyRescueSidecar,
	);
}

function collectExactMatch(
	base: ResidentBase,
	shardLocalFamilySlot: number,
	queryUnitText: string,
	familyFlagsByFamilyId: Uint8Array,
): V3QueryFamilyMatch | null {
	const familyId = getFamilyIdForShardLocalFamilySlot(base, shardLocalFamilySlot);
	if (familyId >= base.familyLexicon.familyCount) {
		return null;
	}
	if (getFamilySourceMask(familyFlagsByFamilyId[familyId] ?? 0) === 0) {
		return null;
	}
	const familyText = getShardLocalFamilyText(base, shardLocalFamilySlot);
	if (familyText !== queryUnitText) {
		return null;
	}
	return {
		familyId,
		shardLocalFamilySlot,
		familyText,
		matchKind: "exact",
		editDistance: 0,
	};
}

function collectBoundedPrefixMatches(
	base: ResidentBase,
	rangeStartShardLocalFamilySlot: number,
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
		let shardLocalFamilySlot = rangeStartShardLocalFamilySlot;
		shardLocalFamilySlot < base.familyLexicon.shardLocalFamilyCount;
		shardLocalFamilySlot += 1
	) {
		const familyId = getFamilyIdForShardLocalFamilySlot(
			base,
			shardLocalFamilySlot,
		);
		const familyText = getShardLocalFamilyText(base, shardLocalFamilySlot);
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
			!canExpandFamilyPrefixForQuery(
				queryUnitText,
				familyText,
				familyFlagsByFamilyId[familyId] ?? 0,
			) ||
			familyText.length <= queryUnitText.length
		) {
			continue;
		}
		insertBoundedPrefixMatch(
			matches,
			{
				familyId,
				shardLocalFamilySlot,
				familyText,
				matchKind: "prefix",
				editDistance: 0,
			},
			queryUnitText,
			matchLimit,
		);
	}
	return matches;
}

function collectBoundedFuzzyMatches(
	base: ResidentBase,
	queryUnitText: string,
	fuzzyBudgetState: FuzzyLookupBudgetState,
	fuzzyRescueSidecar: ResidentFuzzyRescueSidecar,
): V3QueryFamilyMatch[] {
	if (fuzzyBudgetState.exhausted) {
		return [];
	}
	const candidateMetadataFamilyIdsByFuzzyLookupKey =
		fuzzyRescueSidecar.candidateMetadataFamilyIdsByFuzzyLookupKey;
	if (candidateMetadataFamilyIdsByFuzzyLookupKey.size === 0) {
		return [];
	}
	const matches: V3QueryFamilyMatch[] = [];
	const seenFamilyIds = new Set<number>();
	let verifiedCandidateCount = 0;
	for (const lookupKey of buildFuzzyLookupKeys(queryUnitText)) {
		const candidateMetadataFamilyIds =
			candidateMetadataFamilyIdsByFuzzyLookupKey.get(lookupKey);
		if (candidateMetadataFamilyIds == null) {
			continue;
		}
		for (const familyId of candidateMetadataFamilyIds) {
			if (seenFamilyIds.has(familyId)) {
				continue;
			}
			seenFamilyIds.add(familyId);
			verifiedCandidateCount += 1;
			if (verifiedCandidateCount > FUZZY_LOOKUP_MAX_VERIFIED_CANDIDATES) {
				return matches;
			}
			if (shouldAbortFuzzyLookup(fuzzyBudgetState, verifiedCandidateCount)) {
				return matches;
			}
			const shardLocalFamilySlot = getShardLocalFamilySlot(base, familyId);
			const familyText = getShardLocalFamilyText(base, shardLocalFamilySlot);
			const editDistance = resolveEditDistanceAtMostOne(
				queryUnitText,
				familyText,
			);
			if (editDistance == null || editDistance === 0) {
				continue;
			}
			insertBoundedPrefixMatch(
				matches,
				{
					familyId,
					shardLocalFamilySlot,
					familyText,
					matchKind: "fuzzy",
					editDistance,
				},
				queryUnitText,
				FUZZY_LOOKUP_MATCH_LIMIT,
			);
		}
	}
	if (nowMs() - fuzzyBudgetState.startedAtMs > FUZZY_LOOKUP_BUDGET_MS) {
		fuzzyBudgetState.exhausted = true;
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

function findFirstShardLocalFamilySlotAtOrAfter(
	base: ResidentBase,
	queryUnitText: string,
): number {
	return getShardLocalFamilySlot(
		base,
		findFirstFamilyIdAtOrAfter(base, queryUnitText),
	);
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

function canExpandFamilyPrefixForQuery(
	queryUnitText: string,
	familyText: string,
	familyFlags: number,
): boolean {
	return (
		isFamilyPrefixExpandable(familyFlags) ||
		(isHanPrefixQuery(queryUnitText) && isPureHanFamilyText(familyText))
	);
}

function isHanPrefixQuery(queryUnitText: string): boolean {
	return isPureHanFamilyText(queryUnitText) && Array.from(queryUnitText).length >= 3;
}

function isPureHanFamilyText(text: string): boolean {
	return /^[\u4e00-\u9fff]+$/u.test(text);
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

function createFuzzyLookupBudgetState(): FuzzyLookupBudgetState {
	return {
		startedAtMs: nowMs(),
		exhausted: false,
	};
}

function shouldAbortFuzzyLookup(
	state: FuzzyLookupBudgetState,
	verifiedCandidateCount: number,
): boolean {
	if (state.exhausted) {
		return true;
	}
	if (verifiedCandidateCount % FUZZY_LOOKUP_TIME_CHECK_INTERVAL !== 0) {
		return false;
	}
	if (nowMs() - state.startedAtMs <= FUZZY_LOOKUP_BUDGET_MS) {
		return false;
	}
	state.exhausted = true;
	return true;
}

function nowMs(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function shouldAttemptFuzzyRescue(
	queryUnit: V3QueryUnit,
	queryAnalysis: V3QueryAnalysis,
): boolean {
	if (
		queryUnit.source !== "surface" ||
		queryUnit.text.length < FUZZY_RESCUE_MIN_QUERY_LENGTH
	) {
		return false;
	}
	if (queryUnit.surfaceGroupIndex == null) {
		return false;
	}
	return (
		queryAnalysis.surfaceGroups[queryUnit.surfaceGroupIndex]?.kind !== "han"
	);
}

function compareQueryFamilyMatch(
	left: V3QueryFamilyMatch,
	right: V3QueryFamilyMatch,
	queryUnitText: string,
): number {
	if (left.matchKind !== right.matchKind) {
		return getQueryFamilyMatchRank(left.matchKind) - getQueryFamilyMatchRank(right.matchKind);
	}
	if (left.editDistance !== right.editDistance) {
		return left.editDistance - right.editDistance;
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

function getQueryFamilyMatchRank(kind: V3QueryFamilyMatch["matchKind"]): number {
	switch (kind) {
		case "exact":
			return 0;
		case "opaque_exact":
			return 1;
		case "prefix":
			return 2;
		case "fuzzy":
			return 3;
	}
}

function getCompoundPrefixPenalty(match: V3QueryFamilyMatch): number {
	return match.matchKind === "prefix" && /[_./-]/u.test(match.familyText) ? 1 : 0;
}

function resolveEditDistanceAtMostOne(
	queryUnitText: string,
	familyText: string,
): 0 | 1 | null {
	if (queryUnitText === familyText) {
		return 0;
	}
	if (Math.abs(queryUnitText.length - familyText.length) > 1) {
		return null;
	}
	if (queryUnitText.length === familyText.length) {
		let mismatchCount = 0;
		for (let index = 0; index < queryUnitText.length; index += 1) {
			if (queryUnitText[index] === familyText[index]) {
				continue;
			}
			mismatchCount += 1;
			if (mismatchCount > 1) {
				return null;
			}
		}
		return mismatchCount === 1 ? 1 : 0;
	}
	const shorterText =
		queryUnitText.length < familyText.length ? queryUnitText : familyText;
	const longerText =
		queryUnitText.length < familyText.length ? familyText : queryUnitText;
	let shorterIndex = 0;
	let longerIndex = 0;
	let usedSkip = false;
	while (shorterIndex < shorterText.length && longerIndex < longerText.length) {
		if (shorterText[shorterIndex] === longerText[longerIndex]) {
			shorterIndex += 1;
			longerIndex += 1;
			continue;
		}
		if (usedSkip) {
			return null;
		}
		usedSkip = true;
		longerIndex += 1;
	}
	return 1;
}
