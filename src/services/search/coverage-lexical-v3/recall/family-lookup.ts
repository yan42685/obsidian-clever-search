import {
	FAMILY_SOURCE_MASK_FUZZY_RESCUE_METADATA,
	getFamilySourceMask,
	isFamilyPrefixExpandable,
} from "../layout/family-lexicon";
import {
	buildFuzzyLookupKeys,
	FUZZY_RESCUE_MIN_QUERY_LENGTH,
} from "../layout/fuzzy-rescue";
import type { ResidentBase, ResidentFuzzyRescueIndex } from "../layout/types";
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
const FUZZY_PREFIX_PROBE_MAX_QUERY_LENGTH = 16;
const FUZZY_PREFIX_PROBE_MAX_PROBES = 256;
const FUZZY_PREFIX_PROBE_SCAN_BUDGET = 32;
const MORPHOLOGY_LOOKUP_MATCH_LIMIT = 4;
const FUZZY_PREFIX_PROBE_ALPHABET = "aeioubcdfghjklmnpqrstvwxyz0123456789";

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
	fuzzyRescueIndex: ResidentFuzzyRescueIndex = base.fuzzyRescue,
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
						fuzzyRescueIndex,
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
	fuzzyRescueIndex: ResidentFuzzyRescueIndex,
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
	const morphologyMatches = collectMorphologyMatches(
		base,
		queryUnit,
		familyFlagsByFamilyId,
	);
	if (morphologyMatches.length > 0) {
		return morphologyMatches;
	}
	if (!allowFuzzyMatch || !shouldAttemptFuzzyRescue(queryUnit, queryAnalysis)) {
		return [];
	}
	const fuzzyMatches = collectBoundedFuzzyMatches(
		base,
		queryUnitText,
		fuzzyBudgetState,
		fuzzyRescueIndex,
	);
	if (fuzzyMatches.length > 0) {
		return fuzzyMatches;
	}
	if (!allowPrefixMatch) {
		return [];
	}
	return collectBoundedFuzzyPrefixProbeMatches(
		base,
		queryUnitText,
		familyFlagsByFamilyId,
		fuzzyBudgetState,
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

function collectMorphologyMatches(
	base: ResidentBase,
	queryUnit: V3QueryUnit,
	familyFlagsByFamilyId: Uint8Array,
): V3QueryFamilyMatch[] {
	const matches: V3QueryFamilyMatch[] = [];
	for (const probeText of buildEnglishMorphologyProbeTexts(queryUnit.text)) {
		const shardLocalFamilySlot = findFirstShardLocalFamilySlotAtOrAfter(base, probeText);
		const exactMatch = collectExactMatch(
			base,
			shardLocalFamilySlot,
			probeText,
			familyFlagsByFamilyId,
		);
		if (exactMatch == null || exactMatch.familyText === queryUnit.text) {
			continue;
		}
		insertBoundedPrefixMatch(
			matches,
			{
				...exactMatch,
				matchKind: "morphology",
				editDistance: 1,
			},
			queryUnit.text,
			MORPHOLOGY_LOOKUP_MATCH_LIMIT,
		);
	}
	return matches;
}

function collectBoundedFuzzyMatches(
	base: ResidentBase,
	queryUnitText: string,
	fuzzyBudgetState: FuzzyLookupBudgetState,
	fuzzyRescueIndex: ResidentFuzzyRescueIndex,
): V3QueryFamilyMatch[] {
	if (fuzzyBudgetState.exhausted) {
		return [];
	}
	const candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey =
		fuzzyRescueIndex.candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey;
	if (candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.size === 0) {
		return [];
	}
	const matches: V3QueryFamilyMatch[] = [];
	const seenShardLocalFamilySlots = new Set<number>();
	let verifiedCandidateCount = 0;
	for (const lookupKey of buildFuzzyLookupKeys(queryUnitText)) {
		const candidateMetadataShardLocalFamilySlots =
			candidateMetadataShardLocalFamilySlotsByFuzzyLookupKey.get(lookupKey);
		if (candidateMetadataShardLocalFamilySlots == null) {
			continue;
		}
		for (const shardLocalFamilySlot of candidateMetadataShardLocalFamilySlots) {
			if (seenShardLocalFamilySlots.has(shardLocalFamilySlot)) {
				continue;
			}
			seenShardLocalFamilySlots.add(shardLocalFamilySlot);
			verifiedCandidateCount += 1;
			if (verifiedCandidateCount > FUZZY_LOOKUP_MAX_VERIFIED_CANDIDATES) {
				return matches;
			}
			if (shouldAbortFuzzyLookup(fuzzyBudgetState, verifiedCandidateCount)) {
				return matches;
			}
			const familyId = getFamilyIdForShardLocalFamilySlot(
				base,
				shardLocalFamilySlot,
			);
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

function collectBoundedFuzzyPrefixProbeMatches(
	base: ResidentBase,
	queryUnitText: string,
	familyFlagsByFamilyId: Uint8Array,
	fuzzyBudgetState: FuzzyLookupBudgetState,
): V3QueryFamilyMatch[] {
	if (fuzzyBudgetState.exhausted || !isEligibleFuzzyPrefixProbeQuery(queryUnitText)) {
		return [];
	}
	const matches: V3QueryFamilyMatch[] = [];
	const seenShardLocalFamilySlots = new Set<number>();
	let verifiedCandidateCount = 0;
	for (const probeText of buildFuzzyPrefixProbeTexts(queryUnitText)) {
		if (shouldAbortFuzzyLookup(fuzzyBudgetState, verifiedCandidateCount)) {
			return matches;
		}
		const rangeStartShardLocalFamilySlot = findFirstShardLocalFamilySlotAtOrAfter(
			base,
			probeText,
		);
		let scannedPrefixFamilyCount = 0;
		for (
			let shardLocalFamilySlot = rangeStartShardLocalFamilySlot;
			shardLocalFamilySlot < base.familyLexicon.shardLocalFamilyCount;
			shardLocalFamilySlot += 1
		) {
			const familyText = getShardLocalFamilyText(base, shardLocalFamilySlot);
			if (!familyText.startsWith(probeText)) {
				break;
			}
			scannedPrefixFamilyCount += 1;
			if (scannedPrefixFamilyCount > FUZZY_PREFIX_PROBE_SCAN_BUDGET) {
				break;
			}
			if (seenShardLocalFamilySlots.has(shardLocalFamilySlot)) {
				continue;
			}
			seenShardLocalFamilySlots.add(shardLocalFamilySlot);
			verifiedCandidateCount += 1;
			if (verifiedCandidateCount > FUZZY_LOOKUP_MAX_VERIFIED_CANDIDATES) {
				return matches;
			}
			if (shouldAbortFuzzyLookup(fuzzyBudgetState, verifiedCandidateCount)) {
				return matches;
			}
			const familyId = getFamilyIdForShardLocalFamilySlot(
				base,
				shardLocalFamilySlot,
			);
			const sourceMask = getFamilySourceMask(familyFlagsByFamilyId[familyId] ?? 0);
			if (
				(sourceMask & FAMILY_SOURCE_MASK_FUZZY_RESCUE_METADATA) === 0 ||
				!canExpandFamilyPrefixForQuery(familyFlagsByFamilyId[familyId] ?? 0) ||
				familyText.length <= queryUnitText.length
			) {
				continue;
			}
			if (
				resolveEditDistanceAtMostOne(
					queryUnitText,
					familyText.slice(0, queryUnitText.length),
				) !== 1
			) {
				continue;
			}
			insertBoundedPrefixMatch(
				matches,
				{
					familyId,
					shardLocalFamilySlot,
					familyText,
					matchKind: "fuzzy",
					editDistance: 1,
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
			return 0;
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

function canExpandFamilyPrefixForQuery(familyFlags: number): boolean {
	return isFamilyPrefixExpandable(familyFlags);
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
		case "morphology":
			return 3;
		case "fuzzy":
			return 4;
	}
}

function getCompoundPrefixPenalty(match: V3QueryFamilyMatch): number {
	return match.matchKind === "prefix" && /[_./-]/u.test(match.familyText) ? 1 : 0;
}

function buildEnglishMorphologyProbeTexts(queryUnitText: string): string[] {
	if (!isEligibleEnglishMorphologyQuery(queryUnitText)) {
		return [];
	}
	const probes: string[] = [];
	const pushProbe = (probe: string): void => {
		if (
			probe.length >= 4 &&
			probe !== queryUnitText &&
			/^[a-z]+$/u.test(probe) &&
			!probes.includes(probe)
		) {
			probes.push(probe);
		}
	};
	if (queryUnitText.endsWith("ies") && queryUnitText.length >= 6) {
		pushProbe(`${queryUnitText.slice(0, -3)}y`);
	}
	if (queryUnitText.endsWith("ing") && queryUnitText.length >= 7) {
		const base = queryUnitText.slice(0, -3);
		pushProbe(base);
		pushProbe(`${base}e`);
		pushProbe(removeDoubledFinalConsonant(base));
	}
	if (queryUnitText.endsWith("ed") && queryUnitText.length >= 6) {
		const base = queryUnitText.slice(0, -2);
		pushProbe(base);
		pushProbe(`${base}e`);
		pushProbe(removeDoubledFinalConsonant(base));
	}
	if (queryUnitText.endsWith("es") && queryUnitText.length >= 6) {
		pushProbe(queryUnitText.slice(0, -2));
	}
	if (
		queryUnitText.endsWith("s") &&
		!queryUnitText.endsWith("ss") &&
		queryUnitText.length >= 5
	) {
		pushProbe(queryUnitText.slice(0, -1));
	}
	return probes;
}

function isEligibleEnglishMorphologyQuery(queryUnitText: string): boolean {
	return (
		queryUnitText.length >= 5 &&
		queryUnitText.length <= 32 &&
		/^[a-z]+$/u.test(queryUnitText) &&
		/[aeiou]/u.test(queryUnitText)
	);
}

function isEligibleFuzzyPrefixProbeQuery(queryUnitText: string): boolean {
	return (
		queryUnitText.length >= FUZZY_RESCUE_MIN_QUERY_LENGTH &&
		queryUnitText.length <= FUZZY_PREFIX_PROBE_MAX_QUERY_LENGTH &&
		/^[a-z0-9]+$/u.test(queryUnitText) &&
		/[a-z]/u.test(queryUnitText)
	);
}

function buildFuzzyPrefixProbeTexts(queryUnitText: string): string[] {
	const probes: string[] = [];
	const seen = new Set<string>();
	for (
		let index = 1;
		index < queryUnitText.length &&
		probes.length < FUZZY_PREFIX_PROBE_MAX_PROBES;
		index += 1
	) {
		for (
			let alphabetIndex = 0;
			alphabetIndex < FUZZY_PREFIX_PROBE_ALPHABET.length &&
			probes.length < FUZZY_PREFIX_PROBE_MAX_PROBES;
			alphabetIndex += 1
		) {
			const replacement = FUZZY_PREFIX_PROBE_ALPHABET[alphabetIndex] ?? "";
			if (replacement === queryUnitText[index]) {
				continue;
			}
			const probeText =
				queryUnitText.slice(0, index) +
				replacement +
				queryUnitText.slice(index + 1);
			if (seen.has(probeText)) {
				continue;
			}
			seen.add(probeText);
			probes.push(probeText);
		}
	}
	return probes;
}

function removeDoubledFinalConsonant(text: string): string {
	if (text.length < 2) {
		return text;
	}
	const last = text[text.length - 1] ?? "";
	const previous = text[text.length - 2] ?? "";
	if (last !== previous || /[aeiou]/u.test(last)) {
		return text;
	}
	return text.slice(0, -1);
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
