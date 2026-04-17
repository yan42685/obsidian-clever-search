import type { RealizedQueryUnitFamily } from "../ranking/types";
import type { V3QueryAnalysis } from "../query/analysis";
import type {
	V3ResolvedHanSurfaceGroup,
} from "./types";

/**
 * Query-side Han rescue planning. Suitable for recall admission only.
 * Do not treat this as candidate-final rescue coverage.
 */
export function planHanSurfaceGroupRecalls(
	queryAnalysis: V3QueryAnalysis,
): V3ResolvedHanSurfaceGroup[] {
	const out: V3ResolvedHanSurfaceGroup[] = [];
	for (const group of queryAnalysis.surfaceGroups) {
		if (group.kind !== "han") {
			continue;
		}
		const realPrimaryUnits = queryAnalysis.primaryUnits.filter(
			(unit) =>
				unit.surfaceGroupIndex === group.index &&
				unit.source === "han_tokenizer_real",
		);
		const realUnitIndices = realPrimaryUnits.map((unit) => unit.index);
		if (realPrimaryUnits.length === 0) {
			out.push({
				surfaceGroupIndex: group.index,
				surfaceText: group.text,
				realUnitIndices,
				matchedRealUnitIndices: [],
				matchedCharMask: group.coveredCharMask,
				rescueMode: "none",
				rescueBigrams: group.queryResidualUniqueBigrams,
			});
			continue;
		}
		if (group.queryResidualUniqueBigrams.length > 0) {
			out.push({
				surfaceGroupIndex: group.index,
				surfaceText: group.text,
				realUnitIndices,
				matchedRealUnitIndices: realUnitIndices,
				matchedCharMask: group.coveredCharMask,
				rescueMode: "residual_only",
				rescueBigrams: group.queryResidualUniqueBigrams,
			});
			continue;
		}
		out.push({
			surfaceGroupIndex: group.index,
			surfaceText: group.text,
			realUnitIndices,
			matchedRealUnitIndices: [],
			matchedCharMask: Array.from({ length: Array.from(group.text).length }, () => false),
			rescueMode: group.hanBigramTexts.length > 0 ? "whole_group_when_real_miss" : "none",
			rescueBigrams: group.hanBigramTexts,
		});
	}
	return out;
}

/**
 * Candidate-final Han rescue resolution. Ranking, coverage gates, snippets, and
 * other display semantics should consume this instead of query residual fields.
 */
export function resolveCandidateHanSurfaceGroups(
	queryAnalysis: V3QueryAnalysis,
	realizedFamilies: readonly RealizedQueryUnitFamily[],
): V3ResolvedHanSurfaceGroup[] {
	const realizedRealUnitIndices = new Set<number>(
		realizedFamilies
			.filter((family) => family.querySurfaceGroupIndex != null)
			.filter((family) => family.matchKind !== "opaque_exact")
			.map((family) => family.queryUnitIndex),
	);
	const out: V3ResolvedHanSurfaceGroup[] = [];
	for (const group of queryAnalysis.surfaceGroups) {
		if (group.kind !== "han") {
			continue;
		}
		const realPrimaryUnits = queryAnalysis.primaryUnits.filter(
			(unit) =>
				unit.surfaceGroupIndex === group.index &&
				unit.source === "han_tokenizer_real",
		);
		const realUnitIndices = realPrimaryUnits.map((unit) => unit.index);
		const matchedRealUnitIndices = realPrimaryUnits
			.filter((unit) => realizedRealUnitIndices.has(unit.index))
			.map((unit) => unit.index);
		const matchedRealUnitIndexSet = new Set<number>(matchedRealUnitIndices);
		const matchedRealUnitTexts = realPrimaryUnits
			.filter((unit) => matchedRealUnitIndexSet.has(unit.index))
			.map((unit) => unit.text);
		const matchedCharMask = markCoveredHanChars(
			group.text,
			Array.from(group.text).length,
			matchedRealUnitTexts,
		);
		if (realPrimaryUnits.length === 0) {
			out.push({
				surfaceGroupIndex: group.index,
				surfaceText: group.text,
				realUnitIndices,
				matchedRealUnitIndices,
				matchedCharMask,
				rescueMode: "none",
				rescueBigrams: group.queryResidualUniqueBigrams,
			});
			continue;
		}
		if (matchedRealUnitIndices.length === 0) {
			out.push({
				surfaceGroupIndex: group.index,
				surfaceText: group.text,
				realUnitIndices,
				matchedRealUnitIndices,
				matchedCharMask,
				rescueMode: group.hanBigramTexts.length > 0 ? "whole_group_when_real_miss" : "none",
				rescueBigrams: group.hanBigramTexts,
			});
			continue;
		}
		const rescueBigrams = collectUncoveredUniqueBigrams(
			group.text,
			matchedCharMask,
			group.hanBigramTexts,
		);
		out.push({
			surfaceGroupIndex: group.index,
			surfaceText: group.text,
			realUnitIndices,
			matchedRealUnitIndices,
			matchedCharMask,
			rescueMode: rescueBigrams.length > 0 ? "residual_only" : "none",
			rescueBigrams,
		});
	}
	return out;
}

export function collectUncoveredUniqueBigrams(
	surfaceText: string,
	covered: readonly boolean[],
	hanBigramTexts: readonly string[],
): string[] {
	if (hanBigramTexts.length === 0) {
		return [];
	}
	const chars = Array.from(surfaceText);
	const unresolved = new Set<string>();
	for (let index = 0; index < chars.length - 1; index += 1) {
		if (covered[index] && covered[index + 1]) {
			continue;
		}
		unresolved.add(chars[index] + chars[index + 1]);
	}
	return hanBigramTexts.filter((bigram) => unresolved.has(bigram));
}

export function markCoveredHanChars(
	surfaceText: string,
	charLength: number,
	terms: readonly string[],
): boolean[] {
	const covered = Array.from({ length: charLength }, () => false);
	for (const term of terms) {
		let searchStart = 0;
		while (searchStart < surfaceText.length) {
			const matchIndex = surfaceText.indexOf(term, searchStart);
			if (matchIndex < 0) {
				break;
			}
			const termCharLength = Array.from(term).length;
			for (let index = matchIndex; index < matchIndex + termCharLength; index += 1) {
				covered[index] = true;
			}
			searchStart = matchIndex + 1;
		}
	}
	return covered;
}
