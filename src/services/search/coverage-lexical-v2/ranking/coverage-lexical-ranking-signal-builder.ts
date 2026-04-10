import type { CoverageLexicalV2QueryAnalysis } from "../query-units";
import type {
	CoverageLexicalV2BestWindowEvidence,
	CoverageLexicalV2MatchedPrimaryUnitEvidence,
	CoverageLexicalV2MatchedPrimaryUnitFieldProfile,
	CoverageLexicalV2PrimaryUnitMatchQuality,
	CoverageLexicalV2PrimaryUnitProximityScore,
	CoverageLexicalV2RankingCandidate,
	CoverageLexicalV2RankingEvidence,
	CoverageLexicalV2SurfaceCoverageShape,
} from "./coverage-lexical-ranking-types";

const CORROBORATION_BONUS = 0.1;
const FIELD_PRIORITY: ReadonlyArray<keyof CoverageLexicalV2MatchedPrimaryUnitFieldProfile> = [
	"basenameScore",
	"aliasesScore",
	"headingsScore",
	"folderScore",
	"tagScore",
	"bodyScore",
];

export function buildCoverageLexicalV2RankingCandidate(
	queryAnalysis: CoverageLexicalV2QueryAnalysis,
	evidence: CoverageLexicalV2RankingEvidence,
): CoverageLexicalV2RankingCandidate {
	const primaryUnitKeys = new Set(
		queryAnalysis.primaryUnits.map((unit) => createPrimaryUnitKey(unit.surfaceGroupIndex, unit.normalizedText)),
	);
	const matchedPrimaryUnits = evidence.matchedPrimaryUnits.filter((unit) =>
		primaryUnitKeys.has(createPrimaryUnitKey(unit.surfaceGroupIndex, unit.normalizedText)),
	);
	return {
		candidateId: evidence.candidateId,
		distinctMatchedPrimaryQueryUnitCount: countDistinctMatchedPrimaryUnits(matchedPrimaryUnits),
		surfaceCoverageShape: buildSurfaceCoverageShape(queryAnalysis, matchedPrimaryUnits),
		matchedPrimaryUnitFieldProfile: buildFieldProfile(matchedPrimaryUnits),
		primaryUnitMatchQuality: buildPrimaryUnitMatchQuality(matchedPrimaryUnits),
		primaryUnitProximityScore: buildPrimaryUnitProximityScore(matchedPrimaryUnits, evidence.bestWindow ?? null),
		stableDeterministicKey: evidence.stableDeterministicKey,
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

function buildPrimaryUnitMatchQuality(
	matchedPrimaryUnits: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): CoverageLexicalV2PrimaryUnitMatchQuality {
	const quality: CoverageLexicalV2PrimaryUnitMatchQuality = {
		latinExactCount: 0,
		latinPrefixCount: 0,
		latinFuzzyCount: 0,
		hanExactCount: 0,
	};
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
			continue;
		}
		quality.latinFuzzyCount += 1;
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

export function rankCoverageLexicalV2FieldProfileKeys(): readonly (keyof CoverageLexicalV2MatchedPrimaryUnitFieldProfile)[] {
	return FIELD_PRIORITY;
}
