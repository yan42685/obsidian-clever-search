import type { V3QueryAnalysis } from "./query/analysis";
import { isSingletonHanStopChar } from "./query";

export type SingletonHanTarget = Readonly<{
	char: string;
	singletonHanCharIndex: number | null;
	surfaceGroupIndex: number | null;
	kind: "query_singleton" | "residual_singleton";
}>;

export type MatchedHanBigramLike = Readonly<{
	bigramText: string;
	surfaceGroupIndex: number | null;
}>;

type RealizedFamilyLike = Readonly<{
	querySurfaceGroupIndex: number | null;
	queryUnitText: string;
	familyText: string;
	matchKind: string;
}>;

type QueryHanSurfaceSpan = Readonly<{
	surfaceGroupIndex: number;
	text: string;
	chars: readonly string[];
	globalStart: number;
	globalEnd: number;
}>;

type QueryHanCoverageMapper = Readonly<{
	allHanChars: readonly string[];
	surfaceGroupIndexByGlobalIndex: readonly (number | null)[];
	surfaceSpans: readonly QueryHanSurfaceSpan[];
}>;

export function collectCandidateSingletonHanTargets(
	queryAnalysis: V3QueryAnalysis,
	realizedFamilies: readonly RealizedFamilyLike[],
	matchedHanBigrams: readonly MatchedHanBigramLike[] = [],
): SingletonHanTarget[] {
	const targets: SingletonHanTarget[] = [];
	const seen = new Set<string>();
	if (queryAnalysis.querySingletonHanRecallEligible && queryAnalysis.querySingletonHanChar != null) {
		pushSingletonHanTarget(targets, seen, {
			char: queryAnalysis.querySingletonHanChar,
			singletonHanCharIndex: null,
			surfaceGroupIndex: null,
			kind: "query_singleton",
		});
	}
	const residual = collectCandidateResidualSingletonHanTarget(
		queryAnalysis,
		realizedFamilies,
		matchedHanBigrams,
	);
	if (residual != null && !isSingletonHanStopChar(residual.singletonHanChar)) {
		pushSingletonHanTarget(targets, seen, {
			char: residual.singletonHanChar,
			singletonHanCharIndex: residual.singletonHanCharIndex,
			surfaceGroupIndex: residual.surfaceGroupIndex,
			kind: "residual_singleton",
		});
	}
	return targets;
}

export function collectCandidateResidualSingletonHanTarget(
	queryAnalysis: V3QueryAnalysis,
	realizedFamilies: readonly RealizedFamilyLike[],
	matchedHanBigrams: readonly MatchedHanBigramLike[] = [],
):
	| Readonly<{
			singletonHanChar: string;
			singletonHanCharIndex: number;
			surfaceGroupIndex: number | null;
	  }>
	| null {
	const mapper = buildQueryHanCoverageMapper(queryAnalysis);
	if (mapper.allHanChars.length <= 1) {
		return null;
	}
	const coveredMask = Array.from({ length: mapper.allHanChars.length }, () => false);
	for (const family of realizedFamilies) {
		const preferredSurfaceGroupIndex = family.querySurfaceGroupIndex;
		if (family.matchKind === "opaque_exact") {
			markGlobalHanCoverage(coveredMask, mapper, family.familyText, preferredSurfaceGroupIndex);
			if (family.queryUnitText !== family.familyText) {
				markGlobalHanCoverage(
					coveredMask,
					mapper,
					family.queryUnitText,
					preferredSurfaceGroupIndex,
				);
			}
			continue;
		}
		markGlobalHanCoverage(
			coveredMask,
			mapper,
			family.queryUnitText,
			preferredSurfaceGroupIndex,
		);
		if (family.queryUnitText !== family.familyText) {
			markGlobalHanCoverage(
				coveredMask,
				mapper,
				family.familyText,
				preferredSurfaceGroupIndex,
			);
		}
	}
	for (const bigram of matchedHanBigrams) {
		markGlobalHanCoverage(coveredMask, mapper, bigram.bigramText, null);
	}
	const uncoveredIndices: number[] = [];
	for (let index = 0; index < coveredMask.length; index += 1) {
		if (!coveredMask[index]) {
			uncoveredIndices.push(index);
		}
	}
	if (uncoveredIndices.length !== 1) {
		return null;
	}
	const singletonHanCharIndex = uncoveredIndices[0] ?? -1;
	if (singletonHanCharIndex < 0) {
		return null;
	}
	return {
		singletonHanChar: mapper.allHanChars[singletonHanCharIndex] ?? "",
		singletonHanCharIndex,
		surfaceGroupIndex:
			mapper.surfaceGroupIndexByGlobalIndex[singletonHanCharIndex] ?? null,
	};
}

function pushSingletonHanTarget(
	target: SingletonHanTarget[],
	seen: Set<string>,
	input: SingletonHanTarget,
): void {
	const key = `${input.kind}:${input.surfaceGroupIndex ?? -1}:${input.singletonHanCharIndex ?? -1}:${input.char}`;
	if (input.char.length === 0 || seen.has(key)) {
		return;
	}
	seen.add(key);
	target.push(input);
}

function buildQueryHanCoverageMapper(queryAnalysis: V3QueryAnalysis): QueryHanCoverageMapper {
	const allHanChars: string[] = [];
	const surfaceGroupIndexByGlobalIndex: Array<number | null> = [];
	const surfaceSpans: QueryHanSurfaceSpan[] = [];
	for (const group of queryAnalysis.surfaceGroups) {
		if (group.kind !== "han") {
			continue;
		}
		const chars = Array.from(group.text);
		if (chars.length === 0) {
			continue;
		}
		const globalStart = allHanChars.length;
		allHanChars.push(...chars);
		for (let index = 0; index < chars.length; index += 1) {
			surfaceGroupIndexByGlobalIndex.push(group.index);
		}
		surfaceSpans.push({
			surfaceGroupIndex: group.index,
			text: group.text,
			chars,
			globalStart,
			globalEnd: globalStart + chars.length,
		});
	}
	return {
		allHanChars,
		surfaceGroupIndexByGlobalIndex,
		surfaceSpans,
	};
}

function markGlobalHanCoverage(
	coveredMask: boolean[],
	mapper: QueryHanCoverageMapper,
	matchedText: string,
	preferredSurfaceGroupIndex: number | null,
): void {
	const matchedChars = Array.from(matchedText);
	if (matchedChars.length === 0) {
		return;
	}
	const targetSpans =
		preferredSurfaceGroupIndex == null
			? mapper.surfaceSpans
			: mapper.surfaceSpans.filter(
					(span) => span.surfaceGroupIndex === preferredSurfaceGroupIndex,
				);
	for (const span of targetSpans) {
		if (matchedChars.length > span.chars.length) {
			continue;
		}
		for (let start = 0; start <= span.chars.length - matchedChars.length; start += 1) {
			let matched = true;
			for (let index = 0; index < matchedChars.length; index += 1) {
				if (span.chars[start + index] !== matchedChars[index]) {
					matched = false;
					break;
				}
			}
			if (!matched) {
				continue;
			}
			for (let index = 0; index < matchedChars.length; index += 1) {
				coveredMask[span.globalStart + start + index] = true;
			}
		}
	}
}
