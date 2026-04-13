import type { CoverageLexicalV2QueryAnalysis } from "../query";
import type {
	CoverageLexicalV2BestWindowEvidence,
	CoverageLexicalV2CheapExactPrimaryContiguity,
	CoverageLexicalV2CheapExactWitnessSummary,
	CoverageLexicalV2CheapSharedFieldCoverage,
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
	CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
	CoverageLexicalV2PrefixWitnessLite,
	CoverageLexicalV2PrimaryUnitMatchQuality,
	CoverageLexicalV2PrimaryUnitProximityScore,
	CoverageLexicalV2ComparatorCandidate,
	CoverageLexicalV2ComparatorEvidence,
	CoverageLexicalV2SurfaceCoverageShape,
} from "./coverage-lexical-comparator-types";

const CORROBORATION_BONUS = 0.1;
const FIELD_PRIORITY: ReadonlyArray<keyof CoverageLexicalV2MatchedPrimaryUnitFieldProfile> = [
	"basenameScore",
	"aliasesScore",
	"headingsScore",
	"folderScore",
	"tagScore",
	"bodyScore",
];

export function buildCoverageLexicalV2CheapComparatorCandidate(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	evidence: CoverageLexicalV2ComparatorEvidence,
): CoverageLexicalV2ComparatorCandidate {
	const primaryUnitsByKey = new Map(
		queryAnalysis.primaryUnits.map((unit) => [
			createPrimaryUnitKey(unit.surfaceGroupIndex, unit.normalizedText),
			unit,
		] as const),
	);
	const matchedPrimaryUnits = evidence.matchedPrimaryUnits.filter((unit) =>
		primaryUnitsByKey.has(createPrimaryUnitKey(unit.surfaceGroupIndex, unit.normalizedText)),
	);
	return {
		candidateId: evidence.candidateId,
		distinctMatchedPrimaryQueryUnitCount: countDistinctMatchedPrimaryUnits(matchedPrimaryUnits),
		surfaceCoverageShape: buildSurfaceCoverageShape(queryAnalysis, matchedPrimaryUnits),
		cheapExactPrimaryContiguity: buildCheapExactPrimaryContiguity(
			primaryUnitsByKey,
			evidence.cheapExactWitnessSummary,
		),
		cheapSharedFieldCoverage: buildCheapSharedFieldCoverage(matchedPrimaryUnits),
		matchedPrimaryUnitFieldProfile: buildFieldProfile(matchedPrimaryUnits),
		primaryUnitMatchQuality: buildPrimaryUnitMatchQuality(matchedPrimaryUnits),
		stableDeterministicKey: evidence.stableDeterministicKey,
	};
}

export function patchCoverageLexicalV2ComparatorCandidateWithProximity(
	comparatorCandidate: CoverageLexicalV2ComparatorCandidate,
	evidence: CoverageLexicalV2ComparatorEvidence,
): CoverageLexicalV2ComparatorCandidate {
	return {
		...comparatorCandidate,
		primaryUnitProximityScore: buildPrimaryUnitProximityScore(
			evidence.matchedPrimaryUnits,
			evidence.bestWindow ?? null,
		),
	};
}

function countDistinctMatchedPrimaryUnits(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): number {
	return new Set(
		matchedPrimaryUnits.map((unit) => createPrimaryUnitKey(unit.surfaceGroupIndex, unit.normalizedText)),
	).size;
}

function buildSurfaceCoverageShape(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): CoverageLexicalV2SurfaceCoverageShape {
	const matchedGroups = new Set(matchedPrimaryUnits.map((unit) => unit.surfaceGroupIndex));
	const totalGroupCount = queryAnalysis.surfaceShape.groupCount;
	const matchedGroupCount = matchedGroups.size;
	const matchedHanGroups = new Set(
		matchedPrimaryUnits
			.filter((unit) => unit.surfaceKind === "han" || unit.surfaceKind === "mixed")
			.map((unit) => unit.surfaceGroupIndex),
	).size;
	const matchedLatinGroups = new Set(
		matchedPrimaryUnits
			.filter((unit) => unit.surfaceKind === "latin" || unit.surfaceKind === "mixed")
			.map((unit) => unit.surfaceGroupIndex),
	).size;
	const preservesVisibleGrouping = queryAnalysis.surfaceShape.requiresMultiGroupCoverage
		? matchedGroupCount >= totalGroupCount
		: matchedGroupCount > 0;
	const preservesCrossScriptCoverage = queryAnalysis.surfaceShape.requiresCrossScriptCoverage
		? matchedHanGroups > 0 && matchedLatinGroups > 0
		: true;
	return {
		matchedGroupCount,
		totalGroupCount,
		preservesVisibleGrouping,
		preservesCrossScriptCoverage,
	};
}

function buildFieldProfile(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): CoverageLexicalV2MatchedPrimaryUnitFieldProfile {
	const fieldProfile: CoverageLexicalV2MatchedPrimaryUnitFieldProfile = {
		basenameScore: 0,
		aliasesScore: 0,
		headingsScore: 0,
		folderScore: 0,
		tagScore: 0,
		bodyScore: 0,
	};
	for (const unit of matchedPrimaryUnits) {
		const strongestFieldKey = toFieldProfileKey(unit.strongestField);
		fieldProfile[strongestFieldKey] += 1;
		for (const corroboratedField of unit.corroboratedFields ?? []) {
			const corroboratedFieldKey = toFieldProfileKey(corroboratedField);
			if (corroboratedFieldKey === strongestFieldKey) {
				continue;
			}
			fieldProfile[corroboratedFieldKey] += CORROBORATION_BONUS;
		}
	}
	return fieldProfile;
}

function buildCheapExactPrimaryContiguity(
	primaryUnitsByKey: ReadonlyMap<string, CoverageLexicalV2QueryAnalysis["primaryUnits"][number]>,
	cheapExactWitnessSummary: CoverageLexicalV2CheapExactWitnessSummary | undefined,
): CoverageLexicalV2CheapExactPrimaryContiguity {
	const intactSurfacePrimaryUnitKeys = new Set<string>();
	for (const unitKey of cheapExactWitnessSummary?.intactSurfacePrimaryUnitKeys ?? []) {
		const primaryUnit = primaryUnitsByKey.get(unitKey);
		if (
			primaryUnit?.source === "surface_han_segment" ||
			primaryUnit?.source === "latin_segment" ||
			primaryUnit?.source === "mixed_script_segment"
		) {
			intactSurfacePrimaryUnitKeys.add(unitKey);
		}
	}
	return {
		intactExactSurfaceGroupCount: new Set(
			[...intactSurfacePrimaryUnitKeys].map(
				(unitKey) => primaryUnitsByKey.get(unitKey)?.surfaceGroupIndex,
			),
		).size,
		intactExactPrimaryUnitCount: intactSurfacePrimaryUnitKeys.size,
		maxAdjacentExactMatchedPrimaryRunLength:
			cheapExactWitnessSummary?.maxAdjacentExactMatchedPrimaryRunLength ?? 0,
		adjacentExactMatchedPrimaryUnitCount:
			cheapExactWitnessSummary?.adjacentExactMatchedPrimaryUnitCount ?? 0,
	};
}

function buildCheapSharedFieldCoverage(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): CoverageLexicalV2CheapSharedFieldCoverage {
	const fieldsByUnitKey = new Map<string, Set<CoverageLexicalV2MatchedPrimaryUnitEvidence["strongestField"]>>();
	for (const unit of matchedPrimaryUnits) {
		if (unit.matchQuality !== "exact" && unit.matchQuality !== "prefix") {
			continue;
		}
		const unitKey = createPrimaryUnitKey(unit.surfaceGroupIndex, unit.normalizedText);
		const fields =
			fieldsByUnitKey.get(unitKey) ??
			new Set<CoverageLexicalV2MatchedPrimaryUnitEvidence["strongestField"]>();
		fields.add(unit.strongestField);
		for (const corroboratedField of unit.corroboratedFields ?? []) {
			fields.add(corroboratedField);
		}
		fieldsByUnitKey.set(unitKey, fields);
	}
	if (fieldsByUnitKey.size === 0) {
		return {
			coversAllMatchedPrimaryUnitsInOneField: false,
			maxDistinctPrimaryUnitsInSameField: 0,
		};
	}
	const distinctUnitCountByField =
		new Map<CoverageLexicalV2MatchedPrimaryUnitEvidence["strongestField"], number>();
	for (const fields of fieldsByUnitKey.values()) {
		for (const field of fields) {
			distinctUnitCountByField.set(field, (distinctUnitCountByField.get(field) ?? 0) + 1);
		}
	}
	const maxDistinctPrimaryUnitsInSameField = Math.max(...distinctUnitCountByField.values());
	return {
		coversAllMatchedPrimaryUnitsInOneField:
			maxDistinctPrimaryUnitsInSameField === fieldsByUnitKey.size,
		maxDistinctPrimaryUnitsInSameField,
	};
}

function buildPrimaryUnitMatchQuality(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): CoverageLexicalV2PrimaryUnitMatchQuality {
	const quality: CoverageLexicalV2PrimaryUnitMatchQuality = {
		latinExactCount: 0,
		latinPrefixCount: 0,
		latinFuzzyCount: 0,
		hanExactCount: 0,
	};
	const metadataPrefixWitnesses: CoverageLexicalV2PrefixWitnessLite[] = [];
	for (const unit of matchedPrimaryUnits) {
		if (unit.surfaceKind === "han") {
			if (unit.matchQuality === "exact") {
				quality.hanExactCount += 1;
			}
			continue;
		}
		if (unit.matchQuality === "exact") {
			quality.latinExactCount += 1;
			continue;
		}
		if (unit.matchQuality === "prefix") {
			quality.latinPrefixCount += 1;
			if (unit.prefixWitnessLite) {
				metadataPrefixWitnesses.push(unit.prefixWitnessLite);
			}
			continue;
		}
		quality.latinFuzzyCount += 1;
	}
	if (metadataPrefixWitnesses.length > 0) {
		quality.metadataPrefixWitnesses = [...metadataPrefixWitnesses].sort(comparePrefixWitnessesForOrdering);
	}
	return quality;
}

function buildPrimaryUnitProximityScore(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
	bestWindow: CoverageLexicalV2BestWindowEvidence | null,
): CoverageLexicalV2PrimaryUnitProximityScore | null {
	if (bestWindow == null) {
		return null;
	}
	const matchedUnitKeys = new Set(
		matchedPrimaryUnits.map((unit) => createPrimaryUnitKey(unit.surfaceGroupIndex, unit.normalizedText)),
	);
	const coveredWindowKeys = bestWindow.matchedUnitKeys.filter((key) => matchedUnitKeys.has(key));
	if (coveredWindowKeys.length === 0) {
		return null;
	}
	return {
		matchedUnitCount: new Set(coveredWindowKeys).size,
		contiguousSurfaceGroupCount: bestWindow.contiguousSurfaceGroupCount ?? 0,
		windowWidth: bestWindow.windowWidth,
		averageDistance: bestWindow.averageDistance,
		preservesSurfaceOrder: bestWindow.preservesSurfaceOrder,
	};
}

export function createPrimaryUnitKey(surfaceGroupIndex: number, normalizedText: string): string {
	return `${surfaceGroupIndex}:${normalizedText}`;
}

function toFieldProfileKey(field: CoverageLexicalV2MatchedPrimaryUnitEvidence["strongestField"]): keyof CoverageLexicalV2MatchedPrimaryUnitFieldProfile {
	switch (field) {
		case "basename":
			return "basenameScore";
		case "aliases":
			return "aliasesScore";
		case "headings":
			return "headingsScore";
		case "folder":
			return "folderScore";
		case "tag":
			return "tagScore";
		case "body":
			return "bodyScore";
	}
}

function comparePrefixWitnessesForOrdering(
	left: CoverageLexicalV2PrefixWitnessLite,
	right: CoverageLexicalV2PrefixWitnessLite,
): number {
	const fieldComparison = compareNumbersAscending(
		getPrefixWitnessFieldPriority(left.field),
		getPrefixWitnessFieldPriority(right.field),
	);
	if (fieldComparison !== 0) {
		return fieldComparison;
	}
	const cleanBoundaryComparison = compareNumbersDescending(Number(left.cleanBoundary), Number(right.cleanBoundary));
	if (cleanBoundaryComparison !== 0) {
		return cleanBoundaryComparison;
	}
	const compoundPenaltyComparison = compareNumbersAscending(Number(left.compoundPenalty), Number(right.compoundPenalty));
	if (compoundPenaltyComparison !== 0) {
		return compoundPenaltyComparison;
	}
	const completionComparison = compareNumbersAscending(left.surfaceCompletionGain, right.surfaceCompletionGain);
	if (completionComparison !== 0) {
		return completionComparison;
	}
	const docCountComparison = compareNumbersAscending(left.fieldDocCount, right.fieldDocCount);
	if (docCountComparison !== 0) {
		return docCountComparison;
	}
	return left.surfaceText.localeCompare(right.surfaceText);
}

function getPrefixWitnessFieldPriority(field: CoverageLexicalV2PrefixWitnessLite["field"]): number {
	switch (field) {
		case "basename":
			return 0;
		case "aliases":
			return 1;
		case "headings":
			return 2;
		case "folder":
			return 3;
		case "tag":
			return 4;
		case "body":
		default:
			return 5;
	}
}

function compareNumbersDescending(left: number, right: number): number {
	return right - left;
}

function compareNumbersAscending(left: number, right: number): number {
	return left - right;
}

export function rankCoverageLexicalV2FieldProfileKeys(): readonly (keyof CoverageLexicalV2MatchedPrimaryUnitFieldProfile)[] {
	return FIELD_PRIORITY;
}
