import type { CoverageLexicalV2MatchedPrimaryUnitEvidence } from "../ranking";
import type {
	CoverageLexicalV2MergedSourceCandidate,
	CoverageLexicalV2SourceCandidate,
	CoverageLexicalV2SourceKind,
} from "./coverage-lexical-coarse-types";

export function mergeCoverageLexicalV2SourceCandidates(
	sourceCandidates: readonly CoverageLexicalV2SourceCandidate[],
): CoverageLexicalV2MergedSourceCandidate[] {
	const mergedById = new Map<string, CoverageLexicalV2MergedSourceCandidate>();
	for (const sourceCandidate of sourceCandidates) {
		const existing = mergedById.get(sourceCandidate.candidateId);
		if (existing == null) {
			mergedById.set(sourceCandidate.candidateId, {
				candidateId: sourceCandidate.candidateId,
				stableDeterministicKey: sourceCandidate.stableDeterministicKey,
				sourceKinds: [sourceCandidate.sourceKind],
				rankingEvidence: {
					candidateId: sourceCandidate.candidateId,
					stableDeterministicKey: sourceCandidate.stableDeterministicKey,
					matchedPrimaryUnits: dedupeMatchedPrimaryUnits(sourceCandidate.matchedPrimaryUnits ?? []),
					bestWindow: sourceCandidate.bestWindow ?? null,
				},
			});
			continue;
		}

		existing.stableDeterministicKey =
			compareStableKeys(sourceCandidate.stableDeterministicKey, existing.stableDeterministicKey) < 0
				? sourceCandidate.stableDeterministicKey
				: existing.stableDeterministicKey;
		existing.rankingEvidence.stableDeterministicKey = existing.stableDeterministicKey;
		existing.sourceKinds = dedupeSourceKinds([...existing.sourceKinds, sourceCandidate.sourceKind]);
		existing.rankingEvidence.matchedPrimaryUnits = dedupeMatchedPrimaryUnits([
			...existing.rankingEvidence.matchedPrimaryUnits,
			...(sourceCandidate.matchedPrimaryUnits ?? []),
		]);
		existing.rankingEvidence.bestWindow = pickBetterBestWindow(
			existing.rankingEvidence.bestWindow ?? null,
			sourceCandidate.bestWindow ?? null,
		);
	}
	return [...mergedById.values()].sort((left, right) =>
		compareStableKeys(left.stableDeterministicKey, right.stableDeterministicKey),
	);
}

function dedupeMatchedPrimaryUnits(
	units: readonly CoverageLexicalV2MatchedPrimaryUnitEvidence[],
): CoverageLexicalV2MatchedPrimaryUnitEvidence[] {
	const out: CoverageLexicalV2MatchedPrimaryUnitEvidence[] = [];
	for (const unit of units) {
		const alreadyPresent = out.some(
			(existing) =>
				existing.normalizedText === unit.normalizedText &&
				existing.surfaceGroupIndex === unit.surfaceGroupIndex &&
				existing.surfaceKind === unit.surfaceKind &&
				existing.strongestField === unit.strongestField &&
				existing.matchQuality === unit.matchQuality,
		);
		if (alreadyPresent) {
			continue;
		}
		out.push({
			...unit,
			corroboratedFields: unit.corroboratedFields ? [...unit.corroboratedFields] : undefined,
		});
	}
	return out;
}

function dedupeSourceKinds(
	sourceKinds: readonly CoverageLexicalV2SourceKind[],
): CoverageLexicalV2SourceKind[] {
	return [...new Set(sourceKinds)];
}

function pickBetterBestWindow(
	left: CoverageLexicalV2MergedSourceCandidate["rankingEvidence"]["bestWindow"] | null,
	right: CoverageLexicalV2MergedSourceCandidate["rankingEvidence"]["bestWindow"] | null,
) {
	if (left == null) {
		return right;
	}
	if (right == null) {
		return left;
	}
	if (left.matchedUnitKeys.length !== right.matchedUnitKeys.length) {
		return left.matchedUnitKeys.length > right.matchedUnitKeys.length ? left : right;
	}
	if (left.preservesSurfaceOrder !== right.preservesSurfaceOrder) {
		return left.preservesSurfaceOrder ? left : right;
	}
	if (left.windowWidth !== right.windowWidth) {
		return left.windowWidth < right.windowWidth ? left : right;
	}
	if (left.averageDistance !== right.averageDistance) {
		return left.averageDistance < right.averageDistance ? left : right;
	}
	return left;
}

function compareStableKeys(left: string, right: string): number {
	return left.localeCompare(right);
}
