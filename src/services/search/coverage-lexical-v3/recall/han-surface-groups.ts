import type { RealizedQueryUnitFamily } from "../ranking/types";
import type { V3QueryAnalysis } from "../query/analysis";
import type {
	V3ResolvedHanSurfaceGroup,
	V3QueryUnitFamilyMatches,
} from "./types";

/**
 * Family-aware Han rescue planning for recall admission. This is the query-side
 * bridge between tokenizer proposals and the resident family lexicon: once a
 * Han real unit has no family match at all, recall falls back to whole-group
 * bigrams instead of trusting the query-time cover.
 */
export function planHanSurfaceGroupRecallsAfterFamilyLookup(
	queryAnalysis: V3QueryAnalysis,
	unitFamilyMatches: readonly V3QueryUnitFamilyMatches[],
): V3ResolvedHanSurfaceGroup[] {
	const matchedQueryUnitIndexSet = new Set<number>(
		unitFamilyMatches
			.filter((unitMatches) => unitMatches.matches.length > 0)
			.map((unitMatches) => unitMatches.queryUnitIndex),
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
		if (realPrimaryUnits.length === 0) {
			out.push({
				surfaceGroupIndex: group.index,
				surfaceText: group.text,
				realUnitIndices,
				matchedRealUnitIndices: [],
				matchedCharMask: Array.from({ length: Array.from(group.text).length }, () => false),
				rescueMode: "none",
				rescueBigrams: group.hanBigramTexts,
			});
			continue;
		}
		const matchedRealUnitIndices = realPrimaryUnits
			.filter((unit) => matchedQueryUnitIndexSet.has(unit.index))
			.map((unit) => unit.index);
		const matchedRealUnitTexts = realPrimaryUnits
			.filter((unit) => matchedQueryUnitIndexSet.has(unit.index))
			.map((unit) => unit.text);
		const matchedCharMask = markCoveredHanChars(
			group.text,
			Array.from(group.text).length,
			matchedRealUnitTexts,
		);
		const rescueBigrams = collectUncoveredUniqueBigrams(
			group.text,
			matchedCharMask,
			group.hanBigramTexts,
		);
		const hasPotentialTokenizerMismatch = group.hanBigramTexts.length > 0;
		out.push({
			surfaceGroupIndex: group.index,
			surfaceText: group.text,
			realUnitIndices,
			matchedRealUnitIndices,
			matchedCharMask,
			rescueMode:
				rescueBigrams.length > 0
					? "residual_only"
					: hasPotentialTokenizerMismatch
						? "whole_group_when_real_miss"
						: "none",
			rescueBigrams:
				rescueBigrams.length > 0
					? rescueBigrams
					: hasPotentialTokenizerMismatch
						? group.hanBigramTexts
						: [],
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
		const hasUnmatchedRealUnits = matchedRealUnitIndices.length < realUnitIndices.length;
		out.push({
			surfaceGroupIndex: group.index,
			surfaceText: group.text,
			realUnitIndices,
			matchedRealUnitIndices,
			matchedCharMask,
			rescueMode:
				rescueBigrams.length > 0
					? "residual_only"
					: hasUnmatchedRealUnits && group.hanBigramTexts.length > 0
						? "whole_group_when_real_miss"
						: "none",
			rescueBigrams:
				rescueBigrams.length > 0
					? rescueBigrams
					: hasUnmatchedRealUnits
						? group.hanBigramTexts
						: [],
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
	const chars = Array.from(surfaceText);
	for (const term of terms) {
		const termChars = Array.from(term);
		if (termChars.length === 0 || termChars.length > chars.length) {
			continue;
		}
		for (let start = 0; start <= chars.length - termChars.length; start += 1) {
			if (!matchesCharsAt(chars, termChars, start)) {
				continue;
			}
			for (let index = start; index < start + termChars.length; index += 1) {
				covered[index] = true;
			}
		}
	}
	return covered;
}

function matchesCharsAt(
	chars: readonly string[],
	needle: readonly string[],
	start: number,
): boolean {
	for (let offset = 0; offset < needle.length; offset += 1) {
		if (chars[start + offset] !== needle[offset]) {
			return false;
		}
	}
	return true;
}
